import 'reflect-metadata';
import { firstValueFrom, take, toArray } from 'rxjs';
import { WorkflowRunsController } from '../../../../src/api/workflows/workflow-runs.controller';
import { WorkflowsController } from '../../../../src/api/workflows/workflows.controller';
import { WorkflowDefinitions, WorkflowRunUpdates, WorkflowRunView } from '../../../../src/workflow';

const definitions: WorkflowDefinitions = {
  definitions: [{
    id: 'plan-implement-review',
    title: 'Plan, implement, review',
    steps: [
      {
        id: 'plan', title: 'Plan', stage: 'plan', gate: 'human', exitPrompt: 'Commit the plan.',
        sessions: [{ name: 'main', prompt: 'Plan {{item.id}}' }],
      },
      {
        id: 'review', title: 'Review', stage: 'review', gate: 'auto', requires: ['plans/{{item.id}}.md'],
        sessions: [{ name: 'impl', prompt: 'Do it' }, { name: 'review', prompt: 'Review', fork: 'impl', model: 'sonnet' }],
      },
    ],
    doneStage: 'done',
  }, {
    id: 'one', title: 'One', steps: [{ id: 's', title: 'S', stage: 'plan', gate: 'auto', sessions: [{ name: 'main', prompt: 'x' }] }],
  }],
  refused: [{ file: 'bad.yaml', error: 'bad.yaml: title is required' }],
};

const run: WorkflowRunView = {
  id: 'R-20261020-abcdefgh', workflowId: 'one', definition: definitions.definitions[1], itemId: '7',
  item: { id: '7', title: 'Fix it', description: '', url: 'u', stage: 'plan' }, taskId: 'T-20261020-abcd', stepIndex: 0,
  phase: 'sessions', sessions: { main: { status: 'running' } }, state: 'running', createdAt: 't', updatedAt: 't',
};

function make() {
  const runner = {
    definitions: jest.fn().mockResolvedValue(definitions),
    list: jest.fn().mockResolvedValue([run]),
    get: jest.fn().mockResolvedValue(run),
    start: jest.fn().mockResolvedValue(run),
    advance: jest.fn().mockResolvedValue(run),
    stop: jest.fn().mockResolvedValue(run),
  };
  const updates = new WorkflowRunUpdates();
  return { runner, updates, workflows: new WorkflowsController(runner as never), runs: new WorkflowRunsController(runner as never, updates) };
}

describe('WorkflowsController', () => {
  it('lists definitions as a summary (no prompts) and the refused files', async () => {
    const { workflows } = make();
    expect(await workflows.list()).toEqual({
      definitions: [
        {
          id: 'plan-implement-review', title: 'Plan, implement, review', doneStage: 'done',
          steps: [
            { id: 'plan', title: 'Plan', stage: 'plan', gate: 'human', sessions: ['main'] },
            { id: 'review', title: 'Review', stage: 'review', gate: 'auto', sessions: ['impl', 'review'] },
          ],
        },
        { id: 'one', title: 'One', steps: [{ id: 's', title: 'S', stage: 'plan', gate: 'auto', sessions: ['main'] }] },
      ],
      refused: [{ file: 'bad.yaml', error: 'bad.yaml: title is required' }],
    });
  });
});

describe('WorkflowRunsController', () => {
  it('lists runs, of one item or all', async () => {
    const { runner, runs } = make();
    expect(await runs.list({ itemId: '7' })).toEqual([run]);
    expect(runner.list).toHaveBeenCalledWith('7');
    await runs.list({});
    expect(runner.list).toHaveBeenLastCalledWith(undefined);
  });

  it('starts, gets, advances and stops runs through the runner', async () => {
    const { runner, runs } = make();
    expect(await runs.start({ itemId: '7', workflowId: 'one' })).toBe(run);
    expect(runner.start).toHaveBeenCalledWith('7', 'one');
    expect(await runs.get(run.id)).toBe(run);
    expect(runner.get).toHaveBeenCalledWith(run.id);
    expect(await runs.advance(run.id, { force: true })).toBe(run);
    expect(runner.advance).toHaveBeenCalledWith(run.id, { force: true });
    await runs.advance(run.id, {});
    expect(runner.advance).toHaveBeenLastCalledWith(run.id, { force: false });
    await runs.advance(run.id, undefined);
    expect(runner.advance).toHaveBeenLastCalledWith(run.id, { force: false });
    expect(await runs.stop(run.id)).toBe(run);
    expect(runner.stop).toHaveBeenCalledWith(run.id);
  });

  it('answers 201 for a start and 200 for advance and stop', () => {
    const code = (name: keyof WorkflowRunsController) => Reflect.getMetadata('__httpCode__', WorkflowRunsController.prototype[name]);
    expect(code('start')).toBeUndefined();
    expect(code('advance')).toBe(200);
    expect(code('stop')).toBe(200);
  });

  it('declares the stream before the :id route', () => {
    const paths = Object.getOwnPropertyNames(WorkflowRunsController.prototype)
      .map((name) => Reflect.getMetadata('path', (WorkflowRunsController.prototype as unknown as Record<string, object>)[name]) as string | undefined)
      .filter((p) => p !== undefined);
    expect(paths.indexOf('stream')).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('stream')).toBeLessThan(paths.indexOf(':id'));
  });

  it('streams run changes as `run` events', async () => {
    const { updates, runs } = make();
    const events = firstValueFrom(runs.stream().pipe(take(2), toArray()));
    updates.changed(run);
    updates.changed({ ...run, state: 'done' });
    expect(await events).toEqual([{ type: 'run', data: run }, { type: 'run', data: { ...run, state: 'done' } }]);
  });
});
