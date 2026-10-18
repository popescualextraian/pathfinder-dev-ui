import { ConflictException, NotFoundException } from '@nestjs/common';
import { TaskUpdates } from '../../../../src/engine/service/task-updates';
import { TasksService } from '../../../../src/engine/service/tasks.service';
import { config, fakeBridge, fakeLauncher, fakeRecords, record } from './helpers';

function setup(opts: { records?: ReturnType<typeof record>[]; launcher?: Record<string, unknown>; bridge?: Record<string, unknown> } = {}) {
  const records = fakeRecords(opts.records ?? [record()]);
  const launcher = fakeLauncher(opts.launcher);
  const bridge = fakeBridge(opts.bridge);
  const factory = jest.fn(() => bridge);
  const service = new TasksService(records as never, launcher as never, factory as never, config, new TaskUpdates(), { waitTimeoutMs: 50, waitIntervalMs: 1 });
  return { records, launcher, bridge, factory, service };
}

const ID = 'T-20260101-abcd';
const exists = (running: boolean) => ({ inspect: jest.fn(async () => ({ exists: true, running, bridgeUrl: 'http://bridge:8765' })) });
const gone = () => ({ inspect: jest.fn(async () => ({ exists: false, running: false, bridgeUrl: '' })) });

describe('TasksService.close', () => {
  it('closes a running task: bridge stop, container stop and remove, record kept as closed', async () => {
    const { service, bridge, launcher, records } = setup({ records: [record({ lastState: 'running' })] });
    const view = await service.close(ID);
    expect(bridge.stop).toHaveBeenCalled();
    expect(launcher.stop).toHaveBeenCalledWith(ID);
    expect(launcher.remove).toHaveBeenCalledWith(ID);
    expect(launcher.stop.mock.invocationCallOrder[0]).toBeLessThan(launcher.remove.mock.invocationCallOrder[0]);
    expect(view).toMatchObject({ closed: true, state: 'stopped', section: 'done', questions: [] });
    expect(view.closedAt).toEqual(expect.any(String));
    const stored = records.map.get(ID)!;
    expect(stored).toMatchObject({ closed: true, lastState: 'stopped', prompt: 'do it' });
  });

  it('closes an idle task whose container is running', async () => {
    const { service, launcher } = setup();
    expect((await service.close(ID)).closed).toBe(true);
    expect(launcher.remove).toHaveBeenCalledWith(ID);
  });

  it('closes a suspended task: no bridge call, no stop, the container goes', async () => {
    const { service, bridge, launcher } = setup({ records: [record({ lastState: 'suspended' })], launcher: exists(false) });
    expect((await service.close(ID)).closed).toBe(true);
    expect(bridge.stop).not.toHaveBeenCalled();
    expect(launcher.stop).not.toHaveBeenCalled();
    expect(launcher.remove).toHaveBeenCalledWith(ID);
  });

  it('closes a task whose container is gone, and a stopped one', async () => {
    expect((await setup({ launcher: gone() }).service.close(ID)).closed).toBe(true);
    const stopped = setup({ records: [record({ lastState: 'stopped' })], launcher: exists(false) });
    expect((await stopped.service.close(ID)).closed).toBe(true);
    expect(stopped.launcher.remove).toHaveBeenCalledWith(ID);
  });

  it('still closes when the bridge does not answer the stop', async () => {
    const { service, launcher } = setup({ bridge: { stop: jest.fn(async () => { throw new Error('down'); }) } });
    expect((await service.close(ID)).closed).toBe(true);
    expect(launcher.stop).toHaveBeenCalled();
  });

  it('leaves the record open when the container cannot be removed, so closing can be retried', async () => {
    const { service, records } = setup({ launcher: { remove: jest.fn(async () => { throw new Error('docker down'); }) } });
    await expect(service.close(ID)).rejects.toThrow('docker down');
    expect(records.map.get(ID)!.closed).toBeUndefined();
  });

  it('is idempotent: closing a closed task changes nothing', async () => {
    const { service, launcher, records } = setup({ records: [record({ closed: true, closedAt: '2026-01-02T00:00:00.000Z', lastState: 'stopped' })] });
    const view = await service.close(ID);
    expect(view).toMatchObject({ closed: true, closedAt: '2026-01-02T00:00:00.000Z' });
    expect(launcher.stop).not.toHaveBeenCalled();
    expect(launcher.remove).not.toHaveBeenCalled();
    expect(records.update).not.toHaveBeenCalled();
  });

  it('unknown id is NotFound', async () => {
    await expect(setup({ records: [] }).service.close(ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('a closed task', () => {
  const closed = () => setup({ records: [record({ closed: true, closedAt: '2026-01-02T00:00:00.000Z', lastState: 'stopped' })], launcher: gone() });

  it.each([
    ['prompt', (s: TasksService) => s.prompt(ID, 'more')],
    ['answer', (s: TasksService) => s.answer(ID, { text: 'yes' })],
    ['cancel', (s: TasksService) => s.cancel(ID)],
  ])('answers 409 to %s, without starting a container or calling the bridge', async (_verb, act) => {
    const { service, launcher, factory } = closed();
    await expect(act(service)).rejects.toBeInstanceOf(ConflictException);
    expect(launcher.start).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it('is read from the record: get does not inspect the container or call the bridge', async () => {
    const { service, launcher, factory } = closed();
    expect(await service.get(ID)).toMatchObject({ closed: true, state: 'stopped', section: 'done' });
    expect(launcher.inspect).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it('events are not available (409)', async () => {
    await expect(closed().service.events(ID, 0)).rejects.toBeInstanceOf(ConflictException);
  });

  it('stop returns the closed task without touching anything', async () => {
    const { service, launcher } = closed();
    expect((await service.stop(ID)).closed).toBe(true);
    expect(launcher.stop).not.toHaveBeenCalled();
  });

  it('can be deleted: the record goes', async () => {
    const { service, records, launcher } = closed();
    await service.remove(ID);
    expect(records.map.has(ID)).toBe(false);
    expect(launcher.remove).not.toHaveBeenCalled();
  });
});

describe('TasksService.list order', () => {
  it('lists the newest createdAt first, closed ones included', async () => {
    const { service } = setup({
      records: [
        record({ id: 'T-20260101-aaaa', createdAt: '2026-01-01T00:00:00.000Z' }),
        record({ id: 'T-20260103-cccc', createdAt: '2026-01-03T00:00:00.000Z', closed: true, lastState: 'stopped' }),
        record({ id: 'T-20260102-bbbb', createdAt: '2026-01-02T00:00:00.000Z' }),
      ],
    });
    expect((await service.list()).map((v) => v.id)).toEqual(['T-20260103-cccc', 'T-20260102-bbbb', 'T-20260101-aaaa']);
  });
});
