import { BadGatewayException, ConflictException, NotFoundException } from '@nestjs/common';
import { BridgeError, BridgeUnreachableError } from '../../../../src/repository/tasks/bridge/bridge-client';
import { TasksService } from '../../../../src/service/tasks/tasks.service';
import { AGENT_TOKEN, TASK_TOKEN, config, fakeBridge, fakeLauncher, fakeRecords, record, status } from './helpers';

function setup(opts: { records?: ReturnType<typeof record>[]; launcher?: Record<string, unknown>; bridge?: Record<string, unknown> } = {}) {
  const records = fakeRecords(opts.records ?? [record()]);
  const launcher = fakeLauncher(opts.launcher);
  const bridge = fakeBridge(opts.bridge);
  const factory = jest.fn(() => bridge);
  const service = new TasksService(
    records as never, launcher as never, factory as never, config,
    { waitTimeoutMs: 50, waitIntervalMs: 1 },
  );
  return { records, launcher, bridge, factory, service };
}

const ID = 'T-20260101-abcd';
const notRunning = { inspect: jest.fn(async () => ({ exists: true, running: false, bridgeUrl: 'http://bridge:8765' })) };

describe('TasksService.start', () => {
  it('creates a starting record, launches, waits for the bridge and returns a view without tokens', async () => {
    const { service, records, launcher, bridge } = setup({ records: [] });
    const view = await service.start({ prompt: 'hello' });
    expect(view.id).toMatch(/^T-\d{8}-[a-z0-9]{4}$/);
    expect(records.map.get(view.id)!.branch).toBe(`agentic/${view.id}`);
    expect(view.repoUrl).toBe(config.repoUrl);
    expect(view.state).toBe('idle');
    const spec = launcher.launch.mock.calls[0] as unknown as [Record<string, string>];
    expect(spec[0].taskToken).toMatch(/^[0-9a-f]{64}$/);
    expect(spec[0].agentToken).toMatch(/^[0-9a-f]{64}$/);
    expect(spec[0].taskToken).not.toBe(spec[0].agentToken);
    expect(spec[0].branch).toBe(`agentic/${view.id}`);
    expect(records.create.mock.invocationCallOrder[0]).toBeLessThan(launcher.launch.mock.invocationCallOrder[0]);
    expect(records.create.mock.calls[0][0].lastState).toBe('starting');
    const stored = records.map.get(view.id)!;
    expect(stored.bridgeUrl).toBe('http://bridge:8765');
    expect(stored.lastState).toBe('idle');
    expect(bridge.status).toHaveBeenCalled();
    expect(JSON.stringify(view)).not.toContain(spec[0].taskToken);
    expect(JSON.stringify(view)).not.toContain(spec[0].agentToken);
    expect(view).not.toHaveProperty('taskToken');
    expect(view).not.toHaveProperty('agentToken');
  });

  it('passes repoUrl, repoRef and model through', async () => {
    const { service, launcher } = setup({ records: [] });
    const view = await service.start({ prompt: 'p', repoUrl: 'https://x/y.git', repoRef: 'dev', model: 'm' });
    expect(view).toMatchObject({ repoUrl: 'https://x/y.git', repoRef: 'dev', model: 'm' });
    expect(launcher.launch.mock.calls[0]).toEqual([expect.objectContaining({ repoUrl: 'https://x/y.git', repoRef: 'dev', model: 'm' })]);
  });

  it('refuses with 409 at the cap, before launching or recording', async () => {
    const { service, launcher, records } = setup({ records: [], launcher: { countRunning: jest.fn(async () => 2) } });
    await expect(service.start({ prompt: 'p' })).rejects.toBeInstanceOf(ConflictException);
    expect(launcher.launch).not.toHaveBeenCalled();
    expect(records.create).not.toHaveBeenCalled();
  });

  it('deletes the record and rethrows when launching fails', async () => {
    const boom = new Error('docker down');
    const { service, records } = setup({ records: [], launcher: { launch: jest.fn(async () => { throw boom; }) } });
    await expect(service.start({ prompt: 'p' })).rejects.toBe(boom);
    expect(records.map.size).toBe(0);
  });

  it('keeps record and container and throws 502 when the bridge never answers', async () => {
    const { service, records, launcher } = setup({
      records: [], bridge: { status: jest.fn(async () => { throw new BridgeUnreachableError('ECONNREFUSED'); }) },
    });
    await expect(service.start({ prompt: 'p' })).rejects.toBeInstanceOf(BadGatewayException);
    expect(records.map.size).toBe(1);
    expect([...records.map.values()][0].bridgeUrl).toBe('http://bridge:8765');
    expect(launcher.remove).not.toHaveBeenCalled();
  });

  it('retries the id on collision', async () => {
    const { service, records } = setup({ records: [] });
    const real = records.get.getMockImplementation()!;
    records.get.mockImplementationOnce(async () => record());
    records.get.mockImplementation(real);
    const view = await service.start({ prompt: 'p' });
    expect(records.get.mock.calls.length).toBeGreaterThan(1);
    expect(view.id).toBeDefined();
  });
});

describe('TasksService reads', () => {
  it('list returns views from records without bridge calls or tokens', async () => {
    const { service, factory } = setup({ records: [record({ lastState: 'running' })] });
    const views = await service.list();
    expect(views).toHaveLength(1);
    expect(views[0].state).toBe('running');
    expect(factory).not.toHaveBeenCalled();
    expect(JSON.stringify(views)).not.toContain(TASK_TOKEN);
    expect(JSON.stringify(views)).not.toContain(AGENT_TOKEN);
  });

  it('get merges live bridge status and persists it', async () => {
    const live = status({ state: 'waiting', reason: 'asked', summary: 'S', questions: [{ id: 'q1', source: 'ask', text: 'why', options: [], recommendation: null, asked: 'x' }] });
    const { service, records } = setup({ bridge: { status: jest.fn(async () => live) } });
    const view = await service.get(ID);
    expect(view).toMatchObject({ state: 'waiting', reason: 'asked', summary: 'S' });
    expect(view.questions).toHaveLength(1);
    expect(records.map.get(ID)!.lastState).toBe('waiting');
    expect(JSON.stringify(view)).not.toContain(TASK_TOKEN);
  });

  it('get throws NotFound for an unknown id', async () => {
    const { service } = setup();
    await expect(service.get('T-20260101-zzzz')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('get falls back to last state when the bridge is unreachable', async () => {
    const { service } = setup({ bridge: { status: jest.fn(async () => { throw new BridgeUnreachableError('x'); }) } });
    expect((await service.get(ID)).state).toBe('idle');
  });

  it('get reports suspended for a stopped container whose last state was not stopped', async () => {
    const { service, bridge } = setup({ launcher: notRunning });
    expect((await service.get(ID)).state).toBe('suspended');
    expect(bridge.status).not.toHaveBeenCalled();
  });

  it('get keeps stopped for a stopped container', async () => {
    const { service } = setup({ records: [record({ lastState: 'stopped' })], launcher: notRunning });
    expect((await service.get(ID)).state).toBe('stopped');
  });

  it('get reports stopped when the container is gone', async () => {
    const { service } = setup({ launcher: { inspect: jest.fn(async () => ({ exists: false, running: false, bridgeUrl: '' })) } });
    expect((await service.get(ID)).state).toBe('stopped');
  });

  it('get lets other bridge errors propagate', async () => {
    const err = new BridgeError(401, 'unauthorized', 'no');
    const { service } = setup({ bridge: { status: jest.fn(async () => { throw err; }) } });
    await expect(service.get(ID)).rejects.toBe(err);
  });
});

describe('TasksService verbs', () => {
  it('prompt sends text and returns a view', async () => {
    const { service, bridge, launcher } = setup();
    const view = await service.prompt(ID, 'more');
    expect(bridge.prompt).toHaveBeenCalledWith('more');
    expect(view.state).toBe('running');
    expect(launcher.start).not.toHaveBeenCalled();
  });

  it('prompt wakes a stopped container and waits for the bridge before sending', async () => {
    const { service, bridge, launcher } = setup({ launcher: notRunning });
    await service.prompt(ID, 'more');
    expect(launcher.start).toHaveBeenCalledWith(ID);
    expect(bridge.status.mock.invocationCallOrder[0]).toBeLessThan(bridge.prompt.mock.invocationCallOrder[0]);
    expect(launcher.start.mock.invocationCallOrder[0]).toBeLessThan(bridge.status.mock.invocationCallOrder[0]);
  });

  it('prompt does not wake beyond the cap', async () => {
    const { service, launcher } = setup({ launcher: { ...notRunning, countRunning: jest.fn(async () => 2) } });
    await expect(service.prompt(ID, 'x')).rejects.toBeInstanceOf(ConflictException);
    expect(launcher.start).not.toHaveBeenCalled();
  });

  it('prompt is 409 when the container does not exist', async () => {
    const { service, bridge } = setup({ launcher: { inspect: jest.fn(async () => ({ exists: false, running: false, bridgeUrl: '' })) } });
    await expect(service.prompt(ID, 'x')).rejects.toThrow(ConflictException);
    expect(bridge.prompt).not.toHaveBeenCalled();
  });

  it('prompt on unknown id is NotFound', async () => {
    const { service } = setup({ records: [] });
    await expect(service.prompt(ID, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prompt lets bridge errors propagate', async () => {
    const err = new BridgeError(409, 'conflict', 'busy');
    const { service } = setup({ bridge: { prompt: jest.fn(async () => { throw err; }) } });
    await expect(service.prompt(ID, 'x')).rejects.toBe(err);
  });

  const q = (id: string, asked: string) => ({ id, source: 'ask' as const, text: 't', options: [], recommendation: null, asked });

  it('answer defaults to the oldest open question', async () => {
    const { service, bridge } = setup({
      bridge: { status: jest.fn(async () => status({ questions: [q('q2', '2026-01-02'), q('q1', '2026-01-01')] })) },
    });
    await service.answer(ID, { text: 'yes' });
    expect(bridge.answer).toHaveBeenCalledWith({ text: 'yes', question: 'q1' });
  });

  it('answer uses the given question', async () => {
    const { service, bridge } = setup();
    await service.answer(ID, { text: 'yes', question: 'qx' });
    expect(bridge.answer).toHaveBeenCalledWith({ text: 'yes', question: 'qx' });
  });

  it('answer without open question passes undefined and lets the bridge answer 409', async () => {
    const err = new BridgeError(409, 'conflict', 'nothing open');
    const { service, bridge } = setup({ bridge: { answer: jest.fn(async () => { throw err; }) } });
    await expect(service.answer(ID, { text: 'yes' })).rejects.toBe(err);
    expect(bridge.answer).toHaveBeenCalledWith({ text: 'yes', question: undefined });
  });

  it('answer wakes a stopped container first', async () => {
    const { service, launcher, bridge } = setup({ launcher: notRunning });
    await service.answer(ID, { text: 'yes' });
    expect(launcher.start).toHaveBeenCalledWith(ID);
    expect(bridge.answer).toHaveBeenCalled();
  });

  it('cancel calls the bridge', async () => {
    const { service, bridge } = setup();
    const view = await service.cancel(ID);
    expect(bridge.cancel).toHaveBeenCalled();
    expect(view.id).toBe(ID);
  });

  it('stop calls bridge stop then the launcher and records stopped', async () => {
    const { service, bridge, launcher, records } = setup();
    const view = await service.stop(ID);
    expect(bridge.stop.mock.invocationCallOrder[0]).toBeLessThan(launcher.stop.mock.invocationCallOrder[0]);
    expect(records.map.get(ID)!.lastState).toBe('stopped');
    expect(view.state).toBe('stopped');
  });

  it('stop tolerates an unreachable bridge', async () => {
    const { service, launcher } = setup({ bridge: { stop: jest.fn(async () => { throw new BridgeUnreachableError('x'); }) } });
    await service.stop(ID);
    expect(launcher.stop).toHaveBeenCalledWith(ID);
  });

  it('events asks the bridge', async () => {
    const ev = [{ seq: 4 }];
    const { service, bridge } = setup({ bridge: { events: jest.fn(async () => ev) } });
    expect(await service.events(ID, 3)).toBe(ev);
    expect(bridge.events).toHaveBeenCalledWith(3);
  });
});

describe('TasksService.remove', () => {
  it('removes a stopped task: container then record', async () => {
    const { service, launcher, records } = setup({ records: [record({ lastState: 'stopped' })], launcher: notRunning });
    await service.remove(ID);
    expect(launcher.remove).toHaveBeenCalledWith(ID);
    expect(records.map.has(ID)).toBe(false);
  });

  it.each(['idle', 'running', 'suspended'])('refuses with 409 when last state is %s', async (lastState) => {
    const { service, launcher, records } = setup({ records: [record({ lastState })], launcher: notRunning });
    await expect(service.remove(ID)).rejects.toBeInstanceOf(ConflictException);
    expect(launcher.remove).not.toHaveBeenCalled();
    expect(records.map.has(ID)).toBe(true);
  });

  it('refuses when the container is still running even if last state is stopped', async () => {
    const { service, launcher } = setup({ records: [record({ lastState: 'stopped' })] });
    await expect(service.remove(ID)).rejects.toBeInstanceOf(ConflictException);
    expect(launcher.remove).not.toHaveBeenCalled();
  });

  it('cleans up a record whose container is already gone', async () => {
    const { service, records } = setup({ launcher: { inspect: jest.fn(async () => ({ exists: false, running: false, bridgeUrl: '' })) } });
    await service.remove(ID);
    expect(records.map.has(ID)).toBe(false);
  });

  it('unknown id is NotFound', async () => {
    const { service } = setup({ records: [] });
    await expect(service.remove(ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
