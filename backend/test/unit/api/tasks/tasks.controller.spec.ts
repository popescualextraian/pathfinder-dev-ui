import 'reflect-metadata';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';
import { TasksController } from '../../../../src/api/tasks/tasks.controller';
import { BridgeError, TaskEvent as BridgeEvent, BridgeUnreachableError } from '../../../../src/service/tasks/task-errors';

const view = { id: 'T-1', state: 'idle' };
const event = (seq: number): BridgeEvent => ({ seq, ts: 't', task: 'T-1', session: null, agent: 'a', type: 'message', data: { n: seq } });

function make() {
  const tasks = {
    start: jest.fn().mockResolvedValue(view),
    list: jest.fn().mockResolvedValue([view]),
    get: jest.fn().mockResolvedValue(view),
    prompt: jest.fn().mockResolvedValue(view),
    answer: jest.fn().mockResolvedValue(view),
    cancel: jest.fn().mockResolvedValue(view),
    stop: jest.fn().mockResolvedValue(view),
    remove: jest.fn().mockResolvedValue(undefined),
    events: jest.fn().mockResolvedValue([event(1)]),
  };
  const events = { stream: jest.fn().mockResolvedValue(of(event(4), event(5))) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { tasks, events, controller: new TasksController(tasks as any, events as any) };
}

describe('TasksController', () => {
  it('delegates the verbs to the service', async () => {
    const { tasks, controller } = make();
    expect(await controller.start({ prompt: 'p' })).toBe(view);
    expect(tasks.start).toHaveBeenCalledWith({ prompt: 'p' });
    expect(await controller.list()).toEqual([view]);
    expect(await controller.get('T-1')).toBe(view);
    expect(await controller.prompt('T-1', { text: 'hi' })).toBe(view);
    expect(tasks.prompt).toHaveBeenCalledWith('T-1', 'hi');
    await controller.answer('T-1', { text: 'yes', question: 'q' });
    expect(tasks.answer).toHaveBeenCalledWith('T-1', { text: 'yes', question: 'q' });
    await controller.cancel('T-1');
    await controller.stop('T-1');
    await controller.remove('T-1');
    expect(tasks.cancel).toHaveBeenCalledWith('T-1');
    expect(tasks.stop).toHaveBeenCalledWith('T-1');
    expect(tasks.remove).toHaveBeenCalledWith('T-1');
  });

  it('uses 201, 202 and 204 as documented', () => {
    const code = (name: keyof TasksController) => Reflect.getMetadata('__httpCode__', TasksController.prototype[name]);
    expect(Reflect.getMetadata('__httpCode__', TasksController.prototype.start)).toBeUndefined(); // POST default 201
    for (const n of ['prompt', 'answer', 'cancel', 'stop'] as const) expect(code(n)).toBe(202);
    expect(code('remove')).toBe(204);
  });

  it('lists events after since, default 0', async () => {
    const { tasks, controller } = make();
    await controller.eventList('T-1', {});
    await controller.eventList('T-1', { since: 7 });
    expect(tasks.events).toHaveBeenNthCalledWith(1, 'T-1', 0);
    expect(tasks.events).toHaveBeenNthCalledWith(2, 'T-1', 7);
  });

  it('streams events as SSE messages with id = seq and the event as data', async () => {
    const { events, controller } = make();
    const messages = await firstValueFrom((await controller.stream('T-1', {}, undefined)).pipe(toArray()));
    expect(events.stream).toHaveBeenCalledWith('T-1', 0);
    expect(messages).toEqual([
      { id: '4', data: event(4) },
      { id: '5', data: event(5) },
    ]);
  });

  it('prefers Last-Event-ID over the since query, and uses the query otherwise', async () => {
    const { events, controller } = make();
    await controller.stream('T-1', { since: 3 }, '9');
    await controller.stream('T-1', {}, '9');
    await controller.stream('T-1', {}, 'garbage');
    await controller.stream('T-1', { since: 3 }, 'garbage');
    await controller.stream('T-1', { since: 3 });
    expect(events.stream).toHaveBeenNthCalledWith(1, 'T-1', 9);
    expect(events.stream).toHaveBeenNthCalledWith(2, 'T-1', 9);
    expect(events.stream).toHaveBeenNthCalledWith(3, 'T-1', 0);
    expect(events.stream).toHaveBeenNthCalledWith(4, 'T-1', 3);
    expect(events.stream).toHaveBeenNthCalledWith(5, 'T-1', 3);
  });

  it('turns bridge errors on the stream into generic messages without host or detail', async () => {
    const { events, controller } = make();
    events.stream.mockResolvedValueOnce(throwError(() => new BridgeUnreachableError('ECONNREFUSED agentic-ui-task-1:8765')));
    await expect(firstValueFrom(await controller.stream('T-1', {}, undefined))).rejects.toThrow('The task bridge is not reachable');
    events.stream.mockResolvedValueOnce(throwError(() => new BridgeError(401, 'unauthorized', 'bad bearer')));
    await expect(firstValueFrom(await controller.stream('T-1', {}, undefined))).rejects.toThrow('The task bridge answered unexpectedly');
  });
});
