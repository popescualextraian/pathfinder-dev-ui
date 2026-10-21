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
        prompt: 'Plan {{item.id}}',
      },
      {
        id: 'review', title: 'Review', stage: 'review', gate: 'auto', requires: ['plans/{{item.id}}.md'],
        prompt: 'Do it',
      },
    ],
    doneStage: 'done',
  }, {
    id: 'one', title: 'One', steps: [{ id: 's', title: 'S', stage: 'plan', gate: 'auto', prompt: 'x' }],
  }, {
    id: 'free', title: 'Free', steps: [{ id: 's', title: 'S', gate: 'auto', prompt: 'x' }],
  }],
  refused: [{ file: 'bad.yaml', error: 'bad.yaml: title is required', version: 'abc' }],
  versions: { 'plan-implement-review': 'v-pir', one: 'v-one' },
};

const run: WorkflowRunView = {
  id: 'R-20261020-abcdefgh', workflowId: 'one', definition: definitions.definitions[1], itemId: '7',
  item: { id: '7', title: 'Fix it', description: '', url: 'u', stage: 'plan' }, taskId: 'T-20261020-abcd', stepIndex: 0,
  phase: 'sessions', sessions: { main: { status: 'running' } }, state: 'running', createdAt: 't', updatedAt: 't',
};

function make() {
  const runner = {
    list: jest.fn().mockResolvedValue([run]),
    get: jest.fn().mockResolvedValue(run),
    start: jest.fn().mockResolvedValue(run),
    startTask: jest.fn().mockResolvedValue(run),
    advance: jest.fn().mockResolvedValue(run),
    stop: jest.fn().mockResolvedValue(run),
  };
  const updates = new WorkflowRunUpdates();
  const defs = {
    list: jest.fn().mockResolvedValue({ ...definitions, writable: true }),
    read: jest.fn().mockResolvedValue({ definition: definitions.definitions[1], version: 'v1' }),
    validate: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ definition: definitions.definitions[1], version: 'v1' }),
    update: jest.fn().mockResolvedValue({ definition: definitions.definitions[1], version: 'v2' }),
    delete: jest.fn().mockResolvedValue(undefined),
    deleteRefused: jest.fn().mockResolvedValue(undefined),
  };
  return { runner, defs, updates, workflows: new WorkflowsController(defs as never), runs: new WorkflowRunsController(runner as never, updates) };
}

describe('WorkflowsController', () => {
  it('lists definitions as a summary (no prompts, with the file version when known) and the refused files', async () => {
    const { workflows } = make();
    expect(await workflows.list()).toEqual({
      definitions: [
        {
          id: 'plan-implement-review', title: 'Plan, implement, review', doneStage: 'done', version: 'v-pir',
          steps: [
            { id: 'plan', title: 'Plan', stage: 'plan', gate: 'human' },
            { id: 'review', title: 'Review', stage: 'review', gate: 'auto' },
          ],
        },
        { id: 'one', title: 'One', version: 'v-one', steps: [{ id: 's', title: 'S', stage: 'plan', gate: 'auto' }] },
        { id: 'free', title: 'Free', steps: [{ id: 's', title: 'S', gate: 'auto' }] },
      ],
      refused: [{ file: 'bad.yaml', error: 'bad.yaml: title is required', version: 'abc' }],
      writable: true,
    });
  });

  it('reads, validates, creates, updates and deletes through the service', async () => {
    const { defs, workflows } = make();
    const definition = definitions.definitions[1];
    expect(await workflows.read('one')).toEqual({ definition, version: 'v1' });
    expect(defs.read).toHaveBeenCalledWith('one');
    expect(await workflows.validate({ definition } as never)).toEqual({ errors: [] });
    expect(defs.validate).toHaveBeenCalledWith(definition);
    expect(await workflows.create({ id: 'one', definition } as never)).toEqual({ definition, version: 'v1' });
    expect(defs.create).toHaveBeenCalledWith('one', definition);
    expect(await workflows.update('one', { definition, version: 'v1' } as never)).toEqual({ definition, version: 'v2' });
    expect(defs.update).toHaveBeenCalledWith('one', definition, 'v1');
    await workflows.delete('one', { version: 'v2' });
    expect(defs.delete).toHaveBeenCalledWith('one', 'v2');
    await workflows.deleteRefused('bad.yaml', { version: 'abc' });
    expect(defs.deleteRefused).toHaveBeenCalledWith('bad.yaml', 'abc');
  });

  it('declares validate and refused/:file before :id, and answers 200 for validate and 204 for deletes', () => {
    const proto = WorkflowsController.prototype as unknown as Record<string, object>;
    const paths = Object.getOwnPropertyNames(proto).map((n) => [n, Reflect.getMetadata('path', proto[n])] as const).filter(([, p]) => p !== undefined);
    const at = (p: string, method: string) => paths.findIndex(([n, x]) => x === p && n === method);
    expect(at('validate', 'validate')).toBeLessThan(at(':id', 'read'));
    expect(at('refused/:file', 'deleteRefused')).toBeLessThan(at(':id', 'delete'));
    const code = (n: string) => Reflect.getMetadata('__httpCode__', proto[n]);
    expect([code('validate'), code('delete'), code('deleteRefused'), code('create')]).toEqual([200, 204, 204, undefined]);
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

  it('starts a plain task run through the runner', async () => {
    const { runner, runs } = make();
    const input = { itemId: '7', prompt: 'look', title: 'T', model: 'opus', repository: 'r' };
    expect(await runs.startTask(input)).toBe(run);
    expect(runner.startTask).toHaveBeenCalledWith(input);
  });

  it('declares task before the :id routes and answers 201', () => {
    const proto = WorkflowRunsController.prototype as unknown as Record<string, object>;
    const paths = Object.getOwnPropertyNames(proto)
      .map((name) => Reflect.getMetadata('path', proto[name]) as string | undefined).filter((p) => p !== undefined);
    expect(paths.indexOf('task')).toBeGreaterThanOrEqual(0);
    expect(Reflect.getMetadata('__httpCode__', proto.startTask)).toBeUndefined();
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
