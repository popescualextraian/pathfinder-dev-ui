import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkflowConflictError, WorkflowDefinition, WorkflowNotFoundError, WorkflowRunFileRepository, WorkflowRunView, RetryDelays, WorkflowRun,
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

const NOSTAGE: WorkflowDefinition = {
  id: 'nostage', title: 'No stages',
  steps: [
    { id: 'a', title: 'A', gate: 'auto', sessions: [{ name: 'main', prompt: 'Go' }] },
    { id: 'b', title: 'B', gate: 'human', sessions: [{ name: 'b', prompt: 'Next' }] },
  ],
};

const AUTO2: WorkflowDefinition = {
  id: 'auto2', title: 'Auto then human',
  steps: [
    { id: 'a', title: 'A', stage: 'plan', gate: 'auto', sessions: [{ name: 'main', prompt: 'Go' }] },
    { id: 'b', title: 'B', stage: 'review', gate: 'human', requires: ['{{item.title}}/plan.md'], sessions: [{ name: 'b', prompt: 'Next' }] },
  ],
};

describe('WorkflowRunner', () => {
  let dir: string;
  let tasks: FakeWorkflowTasks;
  let items: FakeWorkItems;
  let updates: WorkflowRunUpdates;
  let runner: WorkflowRunner;
  let seen: WorkflowRunView[];

  const make = async (retry?: RetryDelays): Promise<WorkflowRunner> => {
    const r = new WorkflowRunner(tasks, items, new FakeDefinitions([PIR, DUO, AUTO_EXIT, AUTO2, NOSTAGE]), new WorkflowRunFileRepository(dir), updates, retry);
    await r.onModuleInit();
    return r;
  };
  // Tell the runner the task changed and wait until it has processed it.
  const changed = async (taskId: string, r = runner): Promise<WorkflowRunView> => {
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
    jest.useRealTimers();
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

    it('a workflow without stages starts, advances and finishes without any card move', async () => {
    const run = await runner.start('7', 'nostage');
    const t = run.taskId;
    expect(run).toMatchObject({ state: 'running', stepIndex: 0 });
    tasks.finishTurn(t, 'main');
    expect(await changed(t)).toMatchObject({ state: 'running', stepIndex: 1 });
    tasks.finishTurn(t, 'b');
    expect((await changed(t)).state).toBe('awaiting-approval');
    expect(await runner.advance(run.id, {})).toMatchObject({ state: 'done' });
    expect(items.moves).toEqual([]);
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

    it('a failed card move at start keeps the run running with a warning; the retry timer moves the card later', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      runner.onModuleDestroy();
      runner = await make({ initialMs: 1000, maxMs: 4000 });
      items.moveFailure = new Error('gitlab down');
      const run = await runner.start('7', 'pir');
      expect(run).toMatchObject({ state: 'running', warning: 'could not move the item to "plan": gitlab down' });
      expect(run.failureReason).toBeUndefined();
      await expect(runner.start('7', 'pir')).rejects.toBeInstanceOf(WorkflowConflictError); // still active
      items.moveFailure = undefined;
      await jest.advanceTimersByTimeAsync(1000);
      await runner.settled();
      expect(items.moves).toEqual([{ itemId: '7', stage: 'plan' }]);
      const after = await runner.get(run.id);
      expect(after.warning).toBeUndefined();
      expect(JSON.stringify(after)).not.toMatch(/pendingStage/);
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

    const d = await runner.start('8', 'duo');
    tasks.task(d.taskId).state = 'stopped';
    tasks.task(d.taskId).failureReason = 'closed by the user';
    expect(await changed(d.taskId)).toMatchObject({ state: 'failed', failureReason: 'task was stopped: closed by the user' });
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

  it('an adapter error in a change-driven step keeps the run with a warning and retries on the next change', async () => {
    const run = await runner.start('8', 'duo');
    const addSession = tasks.addSession.bind(tasks);
    tasks.addSession = async () => { throw new Error('bridge says no'); };
    tasks.finishTurn(run.taskId, 'main');
    const warned = await changed(run.taskId);
    expect(warned).toMatchObject({ state: 'running', phase: 'sessions', warning: 'could not start session "second": bridge says no' });
    expect(warned.sessions.second.status).toBe('pending');
    tasks.addSession = addSession;
    const retried = await changed(run.taskId);
    expect(retried.warning).toBeUndefined();
    expect(retried.sessions.second.status).toBe('running');
    expect(tasks.added.map((a) => a.name)).toEqual(['second']);
  });

  it('an adapter error during advance is rethrown and leaves the run unchanged', async () => {
    const run = await runner.start('7', 'pir');
    tasks.finishTurn(run.taskId, 'main');
    const waiting = await changed(run.taskId);
    const refused = new Error('bridge 409');
    tasks.prompt = async () => { throw refused; };
    await expect(runner.advance(run.id, {})).rejects.toBe(refused);
    expect(await runner.get(run.id)).toEqual(waiting);

    const duo = await runner.start('8', 'auto-exit');
    tasks.finishTurn(duo.taskId, 'main');
    await changed(duo.taskId); // auto gate: exit prompt fails -> warning, phase kept
    expect(await runner.get(duo.id)).toMatchObject({ state: 'running', phase: 'sessions', warning: expect.stringMatching(/exit prompt.*bridge 409/) });
  });

  it('an item move failing during advance is rethrown; the run stays blocked', async () => {
    const run = await runner.start('7', 'pir');
    tasks.finishTurn(run.taskId, 'main');
    await changed(run.taskId);
    await runner.advance(run.id, {});
    tasks.finishTurn(run.taskId, 'main');
    const blocked = await changed(run.taskId);
    items.moveFailure = new Error('gitlab down');
    await expect(runner.advance(run.id, { force: true })).rejects.toThrow('gitlab down');
    expect(await runner.get(run.id)).toEqual(blocked);
    expect(tasks.added).toEqual([]);
  });

  it('a session the task already has is treated as started (no second addSession after a crash)', async () => {
    const run = await runner.start('8', 'duo');
    tasks.task(run.taskId).sessions.push({ name: 'second', state: 'running', openQuestions: 0 });
    tasks.finishTurn(run.taskId, 'main');
    const r = await changed(run.taskId);
    expect(tasks.added).toEqual([]);
    expect(r.sessions.second.status).toBe('running');
  });

  it('changes that happen while the task is being started are not lost', async () => {
    const start = tasks.start.bind(tasks);
    tasks.start = async (input) => {
      const id = await start(input);
      tasks.finishTurn(id, 'main');
      tasks.emit(id);
      return id;
    };
    const run = await runner.start('7', 'pir');
    await runner.settled();
    expect((await runner.get(run.id)).state).toBe('awaiting-approval');
  });

  it('a suspended session is not done (its container may be gone); it waits', async () => {
    const run = await runner.start('7', 'pir');
    tasks.setSession(run.taskId, 'main', { state: 'running' });
    await changed(run.taskId);
    tasks.setSession(run.taskId, 'main', { state: 'suspended', lastMessageAt: '2026-10-20T13:00:00.000Z' });
    expect((await changed(run.taskId)).state).toBe('running');
    tasks.setSession(run.taskId, 'main', { state: 'idle' });
    expect((await changed(run.taskId)).state).toBe('awaiting-approval');
  });

  it('the exit prompt baseline is read after sending it, so a lagging last message does not count as done', async () => {
    const run = await runner.start('7', 'pir');
    const t = run.taskId;
    tasks.setSession(t, 'main', { state: 'idle', lastMessageAt: '2026-10-20T10:00:00.000Z' });
    expect((await changed(t)).state).toBe('awaiting-approval');
    // The engine has not seen the turn's real last message yet; it shows up right after the exit prompt went out.
    const prompt = tasks.prompt.bind(tasks);
    tasks.prompt = async (taskId, session, text) => {
      await prompt(taskId, session, text);
      tasks.setSession(t, 'main', { lastMessageAt: '2026-10-20T10:00:05.000Z' });
    };
    await runner.advance(run.id, {});
    expect((await changed(t)).phase).toBe('exit');
    tasks.finishTurn(t, 'main');
    tasks.files.add('plans/7.md');
    expect((await changed(t)).stepIndex).toBe(1);
  });

  it('views carry no internal session fields; the stream emits only visible changes', async () => {
    const run = await runner.start('7', 'pir');
    tasks.setSession(run.taskId, 'main', { state: 'running' }); // only an internal field changes
    await changed(run.taskId);
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(await runner.get(run.id))).not.toMatch(/sawBusy|baseline/);
    expect(JSON.stringify(seen)).not.toMatch(/sawBusy|baseline/);
  });

  describe('retry timer', () => {
    beforeEach(async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      runner.onModuleDestroy();
      runner = await make({ initialMs: 1000, maxMs: 4000 });
    });

    it('a transient card move failure in an auto gate step recovers without any task change', async () => {
      const run = await runner.start('8', 'auto2');
      tasks.files.add('Eight/plan.md');
      items.moveFailure = new Error('gitlab down');
      tasks.finishTurn(run.taskId, 'main');
      expect(await changed(run.taskId)).toMatchObject({ state: 'running', stepIndex: 0, warning: 'could not move the item to "review": gitlab down' });
      items.moveFailure = undefined;
      await jest.advanceTimersByTimeAsync(1000);
      await runner.settled();
      const after = await runner.get(run.id);
      expect(after).toMatchObject({ state: 'running', stepIndex: 1 });
      expect(after.warning).toBeUndefined();
      expect(tasks.added.map((a) => a.name)).toEqual(['b']);
    });

    it('backs off, doubling up to the maximum, and stops retrying when the run is stopped', async () => {
      const run = await runner.start('8', 'auto2');
      tasks.files.add('Eight/plan.md');
      let attempts = 0;
      items.moveTo = async () => { attempts++; throw new Error('down'); };
      tasks.finishTurn(run.taskId, 'main');
      await changed(run.taskId);
      expect(attempts).toBe(1);
      const tick = async (ms: number) => { await jest.advanceTimersByTimeAsync(ms); await runner.settled(); };
      await tick(1000); expect(attempts).toBe(2);
      await tick(1999); expect(attempts).toBe(2);
      await tick(1); expect(attempts).toBe(3);
      await tick(4000); expect(attempts).toBe(4);
      await tick(4000); expect(attempts).toBe(5); // capped at 4000
      await runner.stop(run.id);
      await tick(60_000); expect(attempts).toBe(5);
    });

    it('no retries after shutdown', async () => {
      const run = await runner.start('8', 'auto2');
      tasks.files.add('Eight/plan.md');
      let attempts = 0;
      items.moveTo = async () => { attempts++; throw new Error('down'); };
      tasks.finishTurn(run.taskId, 'main');
      await changed(run.taskId);
      runner.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(60_000);
      await runner.settled();
      expect(attempts).toBe(1);
    });
  });

  it('a required path that is unsafe after filling in fails the run instead of retrying', async () => {
    items.items.set('9', { id: '9', title: '..', description: '', url: 'u', stage: 'todo' });
    const run = await runner.start('9', 'auto2');
    tasks.finishTurn(run.taskId, 'main');
    const failed = await changed(run.taskId);
    expect(failed).toMatchObject({ state: 'failed', failureReason: 'required path "../plan.md" is not a relative path inside the worktree' });
    expect(tasks.hasFilesCalls).toEqual([]);
  });

  it('list returns the active runs and the 50 most recently finished ones, oldest first', async () => {
    const repo = new WorkflowRunFileRepository(dir);
    const base = await runner.start('7', 'pir'); // active, created now (newest)
    const template = (await repo.get(base.id))!;
    const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
    const finished: WorkflowRun[] = Array.from({ length: 52 }, (_, n) => ({
      ...template, id: `R-20260101-${String(n).padStart(8, '0')}`, itemId: `x${n}`, state: 'done' as const,
      createdAt: at(n), updatedAt: at(n), finishedAt: at(100 - n), // the first ones created finished last
    }));
    for (const r of finished) await repo.save(r);
    const ids = (await runner.list()).map((r) => r.id);
    expect(ids).toHaveLength(51);
    expect(ids.at(-1)).toBe(base.id);
    // finishedAt: n=0 is the most recent, n=51 and n=50 the oldest two -> dropped.
    expect(ids.slice(0, 50)).toEqual(finished.slice(0, 50).map((r) => r.id));
    expect((await runner.list('x51')).map((r) => r.id)).toEqual([finished[51].id]); // the limit applies within the item
    expect((await runner.list('x3')).map((r) => r.id)).toEqual([finished[3].id]);
  });
});
