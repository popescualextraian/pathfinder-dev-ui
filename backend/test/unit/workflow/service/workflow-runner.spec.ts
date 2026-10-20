import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkflowConflictError, WorkflowDefinition, WorkflowNotFoundError, WorkflowRun, WorkflowRunFileRepository,
  WorkflowRunner, WorkflowRunUpdates,
} from '../../../../src/workflow';
import { FakeDefinitions, FakeWorkflowTasks, FakeWorkItems } from '../../../helpers/fake-workflow';

const PIR: WorkflowDefinition = {
  id: 'pir', title: 'Plan, implement, review', doneStage: 'done',
  steps: [
    {
      id: 'plan', title: 'Plan', stage: 'plan', gate: 'human',
      exitPrompt: 'Commit plans/{{item.id}}.md on {{task.branch}}',
      sessions: [{
        name: 'main', model: 'opus',
        prompt: 'Plan #{{item.id}}: {{item.title}} / {{item.description}} ({{item.url}}) step {{ step.id }} task [{{task.id}}] [{{task.branch}}]',
      }],
    },
    {
      id: 'implement', title: 'Implement', stage: 'in-progress', gate: 'auto', requires: ['plans/{{item.id}}.md'],
      sessions: [{ name: 'impl', prompt: 'Implement plans/{{item.id}}.md in {{task.id}} at {{step.id}}' }],
    },
    {
      id: 'review', title: 'Review', stage: 'review', gate: 'human',
      sessions: [{ name: 'review', fork: 'impl', model: 'sonnet', prompt: 'Review {{task.branch}}' }],
    },
  ],
};

const DUO: WorkflowDefinition = {
  id: 'duo', title: 'Two sessions',
  steps: [
    {
      id: 'work', title: 'Work', stage: 'in-progress', gate: 'auto',
      sessions: [{ name: 'main', prompt: 'Work on {{item.title}}' }, { name: 'second', fork: 'main', model: 'haiku', prompt: 'Check {{item.id}}' }],
    },
  ],
};

const AUTO_EXIT: WorkflowDefinition = {
  id: 'auto-exit', title: 'Auto with exit',
  steps: [
    { id: 'a', title: 'A', stage: 'plan', gate: 'auto', exitPrompt: 'Wrap up {{step.id}}', sessions: [{ name: 'main', prompt: 'Go' }] },
    { id: 'b', title: 'B', stage: 'review', gate: 'human', sessions: [{ name: 'b', prompt: 'Next' }] },
  ],
};

describe('WorkflowRunner', () => {
  let dir: string;
  let tasks: FakeWorkflowTasks;
  let items: FakeWorkItems;
  let updates: WorkflowRunUpdates;
  let runner: WorkflowRunner;
  let seen: WorkflowRun[];

  const make = async (): Promise<WorkflowRunner> => {
    const r = new WorkflowRunner(tasks, items, new FakeDefinitions([PIR, DUO, AUTO_EXIT]), new WorkflowRunFileRepository(dir), updates);
    await r.onModuleInit();
    return r;
  };
  // Tell the runner the task changed and wait until it has processed it.
  const changed = async (taskId: string, r = runner): Promise<WorkflowRun> => {
    tasks.emit(taskId);
    await r.settled();
    return (await r.list()).find((x) => x.taskId === taskId)!;
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wfrun-'));
    tasks = new FakeWorkflowTasks();
    items = new FakeWorkItems([
      { id: '7', title: 'Seven', description: 'Do seven', url: 'https://x/7', stage: 'todo' },
      { id: '8', title: 'Eight', description: '', url: 'https://x/8', stage: 'todo' },
    ]);
    updates = new WorkflowRunUpdates();
    seen = [];
    updates.changes.subscribe((r) => seen.push(r));
    runner = await make();
  });
  afterEach(() => {
    runner.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('start', () => {
    it('starts the task named after the item with the first prompt filled and the model, records the run, moves the card', async () => {
      const run = await runner.start('7', 'pir');
      expect(tasks.starts).toEqual([{
        title: '#7 Seven', model: 'opus',
        prompt: 'Plan #7: Seven / Do seven (https://x/7) step plan task [] []',
      }]);
      expect(run).toMatchObject({
        workflowId: 'pir', itemId: '7', taskId: 'T-20261020-0001', stepIndex: 0, state: 'running', phase: 'sessions',
        sessions: { main: { status: 'running' }, impl: { status: 'pending' }, review: { status: 'pending' } },
      });
      expect(run.definition).toEqual(PIR);
      expect(items.moves).toEqual([{ itemId: '7', stage: 'plan' }]);
      expect(await runner.get(run.id)).toEqual(run);
      expect(seen.map((r) => r.state)).toEqual(['running']);
    });

    it('refuses a second run for an item with an active run, allows one for another item', async () => {
      await runner.start('7', 'pir');
      await expect(runner.start('7', 'duo')).rejects.toBeInstanceOf(WorkflowConflictError);
      await runner.start('8', 'duo');
      expect(tasks.starts).toHaveLength(2);
    });

    it('refuses two concurrent starts for the same item', async () => {
      const results = await Promise.allSettled([runner.start('7', 'pir'), runner.start('7', 'pir')]);
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(tasks.starts).toHaveLength(1);
    });

    it('unknown workflow or item is not found', async () => {
      await expect(runner.start('7', 'nope')).rejects.toBeInstanceOf(WorkflowNotFoundError);
      await expect(runner.start('99', 'pir')).rejects.toBeInstanceOf(WorkflowNotFoundError);
      expect(tasks.starts).toEqual([]);
    });

    it('a failed card move after the task started records the run as failed instead of losing it', async () => {
      items.moveFailure = new Error('gitlab down');
      const run = await runner.start('7', 'pir');
      expect(run.state).toBe('failed');
      expect(run.failureReason).toMatch(/could not move the item to "plan": gitlab down/);
      expect(run.finishedAt).toBeDefined();
      expect((await runner.get(run.id)).state).toBe('failed');
      items.moveFailure = undefined;
      await runner.start('7', 'pir'); // a failed run is not active
    });
  });

  it('get of an unknown run is not found; list filters by item', async () => {
    await expect(runner.get('R-20261020-zzzzzzzz')).rejects.toBeInstanceOf(WorkflowNotFoundError);
    const a = await runner.start('7', 'pir');
    const b = await runner.start('8', 'duo');
    expect((await runner.list()).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect((await runner.list('8')).map((r) => r.id)).toEqual([b.id]);
  });

  it('race guard: idle right after the prompt is not done; done after it was seen busy', async () => {
    const run = await runner.start('7', 'pir');
    tasks.setSession(run.taskId, 'main', { state: 'idle' });
    expect((await changed(run.taskId)).state).toBe('running');
    tasks.setSession(run.taskId, 'main', { state: 'running' });
    expect((await changed(run.taskId)).state).toBe('running');
    tasks.setSession(run.taskId, 'main', { state: 'idle' });
    expect((await changed(run.taskId)).state).toBe('awaiting-approval');
  });

  it('a new final message counts as done even if we never saw the session busy', async () => {
    const run = await runner.start('7', 'pir');
    tasks.finishTurn(run.taskId, 'main');
    expect((await changed(run.taskId)).state).toBe('awaiting-approval');
  });

  it('human gate, exit prompt, then advance through requires, auto gate, fork/model and done with doneStage', async () => {
    const run = await runner.start('7', 'pir');
    const t = run.taskId;
    await expect(runner.advance(run.id, {})).rejects.toBeInstanceOf(WorkflowConflictError);
    tasks.finishTurn(t, 'main');
    expect(await changed(t)).toMatchObject({ state: 'awaiting-approval', phase: 'awaiting-approval' });

    // Continue: the exit prompt goes to the step's last session first.
    tasks.files.add('plans/7.md');
    const exiting = await runner.advance(run.id, {});
    expect(exiting).toMatchObject({ state: 'running', phase: 'exit', stepIndex: 0 });
    expect(tasks.prompts).toEqual([{ taskId: t, session: 'main', text: `Commit plans/7.md on agentic/${t}` }]);
    expect(items.moves).toHaveLength(1);
    await expect(runner.advance(run.id, {})).rejects.toBeInstanceOf(WorkflowConflictError);
    // Still idle right after the exit prompt: not done.
    expect((await changed(t)).phase).toBe('exit');

    tasks.finishTurn(t, 'main');
    const implementing = await changed(t);
    expect(implementing).toMatchObject({ state: 'running', phase: 'sessions', stepIndex: 1 });
    expect(tasks.hasFilesCalls).toEqual([['plans/7.md']]);
    expect(items.moves.at(-1)).toEqual({ itemId: '7', stage: 'in-progress' });
    expect(tasks.added).toEqual([{ taskId: t, name: 'impl', prompt: `Implement plans/7.md in ${t} at implement` }]);

    // Auto gate: on to review, forked with its model.
    tasks.finishTurn(t, 'impl');
    expect(await changed(t)).toMatchObject({ state: 'running', stepIndex: 2 });
    expect(tasks.added[1]).toEqual({ taskId: t, name: 'review', fork: 'impl', model: 'sonnet', prompt: `Review agentic/${t}` });
    expect(items.moves.at(-1)).toEqual({ itemId: '7', stage: 'review' });

    tasks.finishTurn(t, 'review');
    expect((await changed(t)).state).toBe('awaiting-approval');
    const done = await runner.advance(run.id, {});
    expect(done).toMatchObject({ state: 'done', sessions: { main: { status: 'done' }, impl: { status: 'done' }, review: { status: 'done' } } });
    expect(done.finishedAt).toBeDefined();
    expect(items.moves.at(-1)).toEqual({ itemId: '7', stage: 'done' });
    await expect(runner.advance(run.id, {})).rejects.toBeInstanceOf(WorkflowConflictError);
    expect(seen.at(-1)?.state).toBe('done');
  });

  it('missing required files block the run with a warning; advance re-checks; force starts anyway', async () => {
    const run = await runner.start('7', 'pir');
    const t = run.taskId;
    tasks.finishTurn(t, 'main');
    await changed(t);
    await runner.advance(run.id, {});
    tasks.finishTurn(t, 'main');
    const blocked = await changed(t);
    expect(blocked).toMatchObject({ state: 'blocked', phase: 'blocked', stepIndex: 0, warning: 'Missing files: plans/7.md' });
    expect(tasks.added).toEqual([]);

    const still = await runner.advance(run.id, {});
    expect(still).toMatchObject({ state: 'blocked', warning: 'Missing files: plans/7.md' });
    expect(tasks.prompts).toHaveLength(1); // no second exit prompt

    const forced = await runner.advance(run.id, { force: true });
    expect(forced).toMatchObject({ state: 'running', stepIndex: 1 });
    expect(forced.warning).toBeUndefined();
    expect(tasks.added.map((a) => a.name)).toEqual(['impl']);
  });

  it('blocked run continues without force once the files exist', async () => {
    const run = await runner.start('7', 'pir');
    tasks.finishTurn(run.taskId, 'main');
    await changed(run.taskId);
    await runner.advance(run.id, {});
    tasks.finishTurn(run.taskId, 'main');
    expect((await changed(run.taskId)).state).toBe('blocked');
    tasks.files.add('plans/7.md');
    expect(await runner.advance(run.id, {})).toMatchObject({ state: 'running', stepIndex: 1 });
  });

  it('runs the sessions of a step one after another, once each, then the auto gate ends the run', async () => {
    const run = await runner.start('8', 'duo');
    const t = run.taskId;
    tasks.finishTurn(t, 'main');
    tasks.emit(t);
    tasks.emit(t);
    tasks.emit(t);
    await runner.settled();
    expect(tasks.added).toEqual([{ taskId: t, name: 'second', fork: 'main', model: 'haiku', prompt: 'Check 8' }]);
    expect((await runner.get(run.id)).sessions).toEqual(expect.objectContaining({ main: expect.objectContaining({ status: 'done' }) }));
    expect((await changed(t)).state).toBe('running');
    tasks.finishTurn(t, 'second');
    const done = await changed(t);
    expect(done.state).toBe('done');
    expect(items.moves).toEqual([{ itemId: '8', stage: 'in-progress' }]); // no doneStage
  });

  it('auto gate with an exit prompt sends it, then continues by itself', async () => {
    const run = await runner.start('8', 'auto-exit');
    const t = run.taskId;
    tasks.finishTurn(t, 'main');
    expect(await changed(t)).toMatchObject({ state: 'running', phase: 'exit' });
    expect(tasks.prompts).toEqual([{ taskId: t, session: 'main', text: 'Wrap up a' }]);
    tasks.finishTurn(t, 'main');
    expect(await changed(t)).toMatchObject({ state: 'running', stepIndex: 1 });
    expect(tasks.added.map((a) => a.name)).toEqual(['b']);
  });

  it('needs-you while a session has an open question, back when answered, keeping its phase', async () => {
    const run = await runner.start('7', 'pir');
    const t = run.taskId;
    tasks.setSession(t, 'main', { state: 'waiting', openQuestions: 1 });
    expect(await changed(t)).toMatchObject({ state: 'needs-you', phase: 'sessions' });
    tasks.setSession(t, 'main', { state: 'running', openQuestions: 0 });
    expect((await changed(t)).state).toBe('running');
    tasks.finishTurn(t, 'main');
    expect((await changed(t)).state).toBe('awaiting-approval');
    // A question while waiting for approval.
    tasks.setSession(t, 'main', { state: 'waiting', openQuestions: 1 });
    expect(await changed(t)).toMatchObject({ state: 'needs-you', phase: 'awaiting-approval' });
    await expect(runner.advance(run.id, {})).resolves.toMatchObject({ phase: 'exit' }); // the phase decides, not the shown state
  });

  it('a question in the session while waiting for approval returns to awaiting-approval when answered', async () => {
    const run = await runner.start('7', 'pir');
    const t = run.taskId;
    tasks.finishTurn(t, 'main');
    await changed(t);
    tasks.setSession(t, 'main', { state: 'waiting', openQuestions: 1 });
    expect((await changed(t)).state).toBe('needs-you');
    tasks.finishTurn(t, 'main');
    expect((await changed(t)).state).toBe('awaiting-approval');
  });

  it('stop marks the run stopped, leaves the task, ignores later changes, frees the item', async () => {
    const run = await runner.start('7', 'pir');
    const stopped = await runner.stop(run.id);
    expect(stopped).toMatchObject({ state: 'stopped' });
    expect(stopped.finishedAt).toBeDefined();
    tasks.finishTurn(run.taskId, 'main');
    expect((await changed(run.taskId)).state).toBe('stopped');
    await expect(runner.stop(run.id)).rejects.toBeInstanceOf(WorkflowConflictError);
    await expect(runner.stop('R-20261020-zzzzzzzz')).rejects.toBeInstanceOf(WorkflowNotFoundError);
    expect(tasks.tasks.has(run.taskId)).toBe(true);
    await runner.start('7', 'pir');
  });

  it('fails the run when the task vanished, failed or was stopped', async () => {
    const a = await runner.start('7', 'pir');
    tasks.tasks.delete(a.taskId);
    expect(await changed(a.taskId)).toMatchObject({ state: 'failed', failureReason: `task ${a.taskId} no longer exists` });

    const b = await runner.start('8', 'pir');
    tasks.task(b.taskId).state = 'failed';
    tasks.task(b.taskId).failureReason = 'bridge crashed';
    expect(await changed(b.taskId)).toMatchObject({ state: 'failed', failureReason: 'task failed: bridge crashed' });

    const c = await runner.start('7', 'duo');
    tasks.task(c.taskId).state = 'stopped';
    const failed = await changed(c.taskId);
    expect(failed).toMatchObject({ state: 'failed', failureReason: 'task was stopped' });
    expect(failed.finishedAt).toBeDefined();
  });

  it('after a restart a new runner resumes active runs and fails those whose task is gone', async () => {
    const a = await runner.start('7', 'pir');
    const b = await runner.start('8', 'duo');
    runner.onModuleDestroy();
    tasks.finishTurn(a.taskId, 'main'); // happened while the app was down
    tasks.tasks.delete(b.taskId);

    runner = await make();
    expect((await runner.get(a.id)).state).toBe('awaiting-approval');
    expect(await runner.get(b.id)).toMatchObject({ state: 'failed', failureReason: `task ${b.taskId} no longer exists` });
    // And it follows changes again.
    tasks.setSession(a.taskId, 'main', { state: 'waiting', openQuestions: 1 });
    expect((await changed(a.taskId)).state).toBe('needs-you');
  });

  it('the old runner ignores changes after it was destroyed', async () => {
    const run = await runner.start('7', 'pir');
    runner.onModuleDestroy();
    tasks.finishTurn(run.taskId, 'main');
    tasks.emit(run.taskId);
    await runner.settled();
    expect((await runner.get(run.id)).state).toBe('running');
  });

  it('publishes every change of a run on the stream', async () => {
    const run = await runner.start('7', 'pir');
    tasks.finishTurn(run.taskId, 'main');
    await changed(run.taskId);
    await runner.stop(run.id);
    expect(seen.map((r) => [r.id, r.state])).toEqual([[run.id, 'running'], [run.id, 'awaiting-approval'], [run.id, 'stopped']]);
  });

  it('an adapter error while moving on fails the run with the reason', async () => {
    const run = await runner.start('8', 'duo');
    tasks.addSession = async () => { throw new Error('bridge says no'); };
    tasks.finishTurn(run.taskId, 'main');
    expect(await changed(run.taskId)).toMatchObject({ state: 'failed', failureReason: 'could not start session "second": bridge says no' });
  });
});
