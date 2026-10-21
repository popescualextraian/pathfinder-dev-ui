import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowRunFileRepository, WorkflowRunner, WorkflowRunUpdates } from '../../../../src/workflow';
import { sessionOfStep } from '../../../../src/workflow/service/step-session';
import { upgradeRunDefinition } from '../../../../src/workflow/service/upgrade-run';
import { FakeDefinitions, FakeWorkflowTasks, FakeWorkItems } from '../../../helpers/fake-workflow';

// A run saved before one-session steps: shape of a plan-implement-review run waiting at the plan step's gate.
const RUN_ID = 'R-20261021-hk0su4i8';
const oldRun = () => ({
  id: RUN_ID, workflowId: 'plan-implement-review', itemId: '7', taskId: 'T-20261020-0001', stepIndex: 0, phase: 'awaiting-approval', state: 'awaiting-approval',
  item: { id: '7', title: 'Seven', description: 'Do seven', url: 'https://x/7', stage: 'plan' },
  definition: {
    id: 'plan-implement-review', title: 'Plan, implement, review', doneStage: 'done',
    steps: [
      { id: 'plan', title: 'Plan', stage: 'plan', gate: 'human', exitPrompt: 'Commit plans/{{item.id}}.md', sessions: [{ name: 'main', prompt: 'Plan #{{item.id}}' }] },
      { id: 'implement', title: 'Implement', stage: 'in-progress', gate: 'auto', requires: ['plans/{{item.id}}.md'], sessions: [{ name: 'impl', prompt: 'Implement it' }] },
      { id: 'review', title: 'Review', stage: 'review', gate: 'human', sessions: [{ name: 'review', fork: 'impl', model: 'sonnet', prompt: 'Review it' }, { name: 'extra', prompt: 'dropped' }] },
    ],
  },
  sessions: { main: { status: 'done', baseline: '2026-10-20T10:00:00.000Z' }, impl: { status: 'pending' }, review: { status: 'pending' }, extra: { status: 'pending' } },
  createdAt: '2026-10-21T08:00:00.000Z', updatedAt: '2026-10-21T08:10:00.000Z',
});

describe('upgradeRunDefinition', () => {
  it('turns the first session of each step into prompt, model and fork; the session name is kept in `session`', () => {
    const run = upgradeRunDefinition(oldRun() as never);
    expect(run.definition.steps).toEqual([
      { id: 'plan', title: 'Plan', stage: 'plan', gate: 'human', exitPrompt: 'Commit plans/{{item.id}}.md', prompt: 'Plan #{{item.id}}', session: 'main' },
      { id: 'implement', title: 'Implement', stage: 'in-progress', gate: 'auto', requires: ['plans/{{item.id}}.md'], prompt: 'Implement it', session: 'impl' },
      { id: 'review', title: 'Review', stage: 'review', gate: 'human', fork: 'implement', model: 'sonnet', prompt: 'Review it', session: 'review' },
    ]);
    expect(run.definition.steps.map((_, i) => sessionOfStep(run.definition, i))).toEqual(['main', 'impl', 'review']);
  });

  it('leaves a run in the new format as it is (same object)', () => {
    const upgraded = upgradeRunDefinition(oldRun() as never);
    expect(upgradeRunDefinition(upgraded)).toBe(upgraded);
  });
});

describe('a run saved in the old format', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wfold-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('loads from the file, shows, and advances through its session names', async () => {
    writeFileSync(join(dir, `${RUN_ID}.json`), JSON.stringify(oldRun()), { mode: 0o600 });
    const tasks = new FakeWorkflowTasks();
    tasks.tasks.set('T-20261020-0001', { id: 'T-20261020-0001', state: 'idle', branch: 'agentic/T-1', sessions: [{ name: 'main', state: 'idle', openQuestions: 0, lastMessageAt: '2026-10-20T10:00:00.000Z' }] });
    const items = new FakeWorkItems([{ id: '7', title: 'Seven', description: 'Do seven', url: 'https://x/7', stage: 'plan' }]);
    const runner = new WorkflowRunner(tasks, items, new FakeDefinitions([]), new WorkflowRunFileRepository(dir), new WorkflowRunUpdates());
    await runner.onModuleInit();
    try {
      const shown = await runner.get(RUN_ID);
      expect(shown).toMatchObject({ state: 'awaiting-approval', phase: 'awaiting-approval', sessions: { main: { status: 'done' }, impl: { status: 'pending' } } });
      expect(shown.definition.steps[1]).toMatchObject({ prompt: 'Implement it', session: 'impl' });

      // Continue: the exit prompt goes to main, then the next step starts its session "impl" (not "implement").
      tasks.files.add('plans/7.md');
      expect(await runner.advance(RUN_ID)).toMatchObject({ phase: 'exit' });
      expect(tasks.prompts).toEqual([{ taskId: 'T-20261020-0001', session: 'main', text: 'Commit plans/7.md' }]);
      tasks.finishTurn('T-20261020-0001', 'main');
      tasks.emit('T-20261020-0001');
      await runner.settled();
      expect(tasks.added).toEqual([{ taskId: 'T-20261020-0001', name: 'impl', prompt: 'Implement it' }]);
      tasks.finishTurn('T-20261020-0001', 'impl');
      tasks.emit('T-20261020-0001');
      await runner.settled();
      expect(tasks.added[1]).toEqual({ taskId: 'T-20261020-0001', name: 'review', fork: 'impl', model: 'sonnet', prompt: 'Review it' });
      expect(await runner.get(RUN_ID)).toMatchObject({ stepIndex: 2, state: 'running' });
      // Saved again, it is in the new format.
      const saved = JSON.parse(readFileSync(join(dir, `${RUN_ID}.json`), 'utf8'));
      expect(saved.definition.steps[2]).toMatchObject({ fork: 'implement', session: 'review' });
      expect(JSON.stringify(saved.definition)).not.toMatch(/"sessions"/);
    } finally {
      runner.onModuleDestroy();
    }
  });
});
