import { Logger } from '@nestjs/common';
import { BadGatewayException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BridgeError, BridgeUnreachableError } from '../../../../src/engine/service/bridge-client';
import { TaskUpdates } from '../../../../src/engine/service/task-updates';
import { TaskCostService } from '../../../../src/engine/service/cost/task-cost.service';
import { TasksService } from '../../../../src/engine/service/tasks.service';
import { AGENT_TOKEN, TASK_TOKEN, config, fakeBridge, fakeLauncher, fakeRecords, record, status } from './helpers';

function setup(opts: { records?: ReturnType<typeof record>[]; launcher?: Record<string, unknown>; bridge?: Record<string, unknown> } = {}) {
  const records = fakeRecords(opts.records ?? [record()]);
  const launcher = fakeLauncher(opts.launcher);
  const bridge = fakeBridge(opts.bridge);
  const factory = jest.fn(() => bridge);
  const updates = new TaskUpdates();
  const published: unknown[] = [];
  updates.changes.subscribe((change) => published.push(change));
  const service = new TasksService(
    records as never, launcher as never, factory as never, config, updates, new TaskCostService(records as never, launcher as never),
    { waitTimeoutMs: 50, waitIntervalMs: 1 },
  );
  return { records, launcher, bridge, factory, service, updates, published };
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
    expect(view).not.toHaveProperty('bridgeUrl');
    expect(view).not.toHaveProperty('containerName');
  });

  it('uses the first line of the prompt, shortened to 80 characters, as the title; the prompt stays whole', async () => {
    const { service, records } = setup({ records: [] });
    const long = `\n\n  ${'word '.repeat(30)}\nsecond line`;
    const view = await service.start({ prompt: long });
    expect(view.title).toHaveLength(80);
    expect(view.title.endsWith('…')).toBe(true);
    expect(view.title).not.toContain('second');
    expect(view.prompt).toBe(long);
    expect(records.map.get(view.id)!.title).toBe(view.title);
    expect((await service.start({ prompt: 'Fix the bug\nmore text' })).title).toBe('Fix the bug');
  });

  it('takes a given title (trimmed, shortened to 80 characters)', async () => {
    const { service } = setup({ records: [] });
    expect((await service.start({ prompt: 'p', title: '  My title ' })).title).toBe('My title');
    expect((await service.start({ prompt: 'p', title: 'y'.repeat(150) })).title).toHaveLength(80);
  });

  it('starts in the default repository, or in a named one', async () => {
    const { service, launcher } = setup({ records: [] });
    const byDefault = await service.start({ prompt: 'p' });
    expect(byDefault).toMatchObject({ repository: 'default', repoUrl: 'https://github.com/acme/default.git' });
    const named = await service.start({ prompt: 'p', repository: 'docs' });
    expect(named).toMatchObject({ repository: 'docs', repoUrl: 'https://gitlab.com/acme/docs.git' });
    expect((launcher.launch.mock.calls[1] as unknown as [{ repoUrl: string }])[0].repoUrl).toBe('https://gitlab.com/acme/docs.git');
  });

  it('refuses an unknown repository name and repository together with repoUrl (400)', async () => {
    const { service, launcher } = setup({ records: [] });
    await expect(service.start({ prompt: 'p', repository: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.start({ prompt: 'p', repository: 'docs', repoUrl: 'https://github.com/x/y' })).rejects.toBeInstanceOf(BadRequestException);
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it('names the repository of a repoUrl after the configured one, else after its last path part', async () => {
    const { service } = setup({ records: [] });
    expect((await service.start({ prompt: 'p', repoUrl: 'https://gitlab.com/acme/docs.git' })).repository).toBe('docs');
    expect((await service.start({ prompt: 'p', repoUrl: 'https://github.com/x/other.git' })).repository).toBe('other');
  });

  it('records the kind given at start and shows it in the view; none by default', async () => {
    const { service, records } = setup({ records: [] });
    const view = await service.start({ prompt: 'p', kind: 'workflow-generator' });
    expect(view.kind).toBe('workflow-generator');
    expect(records.map.get(view.id)?.kind).toBe('workflow-generator');
    expect('kind' in (await service.start({ prompt: 'q' }))).toBe(false);
  });

  it('passes repoUrl, repoRef and model through', async () => {
    const { service, launcher } = setup({ records: [] });
    const view = await service.start({ prompt: 'p', repoUrl: 'https://github.com/x/y.git', repoRef: 'dev', model: 'm' });
    expect(view).toMatchObject({ repoUrl: 'https://github.com/x/y.git', repoRef: 'dev', model: 'm' });
    expect(launcher.launch.mock.calls[0]).toEqual([expect.objectContaining({ repoUrl: 'https://github.com/x/y.git', repoRef: 'dev', model: 'm' })]);
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

  it('refuses a repoUrl whose host is not allowed, before anything happens', async () => {
    const { service, launcher, records } = setup({ records: [] });
    for (const url of ['https://attacker.example/r.git', 'https://github.com.evil.example/r.git', 'https://GITHUB.com:444@evil.example/r.git']) {
      await expect(service.start({ prompt: 'p', repoUrl: url })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(launcher.countRunning).not.toHaveBeenCalled();
    expect(launcher.launch).not.toHaveBeenCalled();
    expect(records.create).not.toHaveBeenCalled();
  });

  it('accepts a repoUrl on an allowed host, case-insensitively', async () => {
    const { service } = setup({ records: [] });
    expect((await service.start({ prompt: 'p', repoUrl: 'https://GitHub.com/a/b.git' })).repoUrl).toBe('https://GitHub.com/a/b.git');
  });

  it('does not hold the start lock while waiting for the bridge', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = jest.fn(async () => { await gate; return status(); });
    const { service, launcher } = setup({ records: [], bridge: { status: slow } });
    const first = service.start({ prompt: 'one' });
    await new Promise((r) => setTimeout(r, 10));
    const second = service.start({ prompt: 'two' });
    await new Promise((r) => setTimeout(r, 10));
    expect(launcher.launch).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, second]);
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

  it('get does not overwrite a recorded stopped with a bridge state', async () => {
    const { service, records } = setup({ records: [record({ lastState: 'stopped' })], bridge: { status: jest.fn(async () => status({ state: 'running' })) } });
    await service.get(ID);
    expect(records.map.get(ID)!.lastState).toBe('stopped');
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

  describe('a stopped task', () => {
    const stoppedRecord = record({ lastState: 'stopped' });

    it.each([
      ['prompt', (svc: TasksService) => svc.prompt(ID, 'x')],
      ['answer', (svc: TasksService) => svc.answer(ID, { text: 'yes' })],
    ])('%s is 409 "task is stopped" at once, without starting the container', async (_n, call) => {
      const { service, launcher, bridge } = setup({ records: [stoppedRecord], launcher: notRunning });
      const error = await call(service).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toMatch(/task is stopped/i);
      expect(launcher.start).not.toHaveBeenCalled();
      expect(bridge.status).not.toHaveBeenCalled();
      expect(bridge.prompt).not.toHaveBeenCalled();
      expect(bridge.answer).not.toHaveBeenCalled();
    });

    it('prompt is 409 when the running bridge reports stopped, and records it', async () => {
      const { service, bridge, records } = setup({ bridge: { status: jest.fn(async () => status({ state: 'stopped' })) } });
      await expect(service.prompt(ID, 'x')).rejects.toThrow(/task is stopped/i);
      expect(bridge.prompt).not.toHaveBeenCalled();
      expect(records.map.get(ID)!.lastState).toBe('stopped');
    });

    it('prompt still goes through when the running bridge cannot be asked for its status', async () => {
      const { service, bridge } = setup({ bridge: { status: jest.fn(async () => { throw new BridgeUnreachableError('x'); }) } });
      await service.prompt(ID, 'x');
      expect(bridge.prompt).toHaveBeenCalledWith('x');
    });

    it.each(['idle', 'suspended', 'running'])(
      'a container stopped externally (last state %s) is still woken',
      async (lastState) => {
        const { service, launcher, bridge } = setup({ records: [record({ lastState })], launcher: notRunning });
        await service.prompt(ID, 'more');
        expect(launcher.start).toHaveBeenCalledWith(ID);
        expect(bridge.prompt).toHaveBeenCalledWith('more');
      },
    );

    it('a woken container whose bridge turns out stopped is stopped again and 409', async () => {
      const { service, launcher, bridge, records } = setup({
        launcher: notRunning, bridge: { status: jest.fn(async () => status({ state: 'stopped' })) },
      });
      await expect(service.prompt(ID, 'x')).rejects.toThrow(/task is stopped/i);
      expect(launcher.start).toHaveBeenCalledWith(ID);
      expect(launcher.stop).toHaveBeenCalledWith(ID);
      expect(bridge.prompt).not.toHaveBeenCalled();
      expect(records.map.get(ID)!.lastState).toBe('stopped');
    });
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

  describe('sessions', () => {
    const bs = (name: string, created: string, state = 'idle') =>
      ({ name, session: null, model: null, state, reason: '', summary: '', inbox: 0, fork_of: null, created, updated: created }) as never;

    it('prompt and cancel pass the session only when given', async () => {
      const { service, bridge } = setup();
      await service.prompt(ID, 'a');
      expect(bridge.prompt).toHaveBeenLastCalledWith('a');
      await service.prompt(ID, 'b', 'impl');
      expect(bridge.prompt).toHaveBeenLastCalledWith('b', 'impl');
      await service.cancel(ID, 'impl');
      expect(bridge.cancel).toHaveBeenLastCalledWith('impl');
    });

    it('addSession wakes the task, maps the input and returns the view with the sessions', async () => {
      const sessions = [bs('main', '2026-01-01T00:00:00Z'), { ...(bs('impl', '2026-01-01T00:01:00Z') as object), fork_of: 'main', model: 'm' } as never];
      const { service, bridge, launcher, records } = setup({
        launcher: notRunning, bridge: { status: jest.fn(async () => status({ state: 'running', sessions })) },
      });
      const view = await service.addSession(ID, { name: 'impl', model: 'm', forkFrom: 'main', prompt: 'go' });
      expect(launcher.start).toHaveBeenCalled();
      expect(bridge.addSession).toHaveBeenCalledWith({ name: 'impl', model: 'm', fork: 'main', text: 'go' });
      expect(view.sessions.map((s) => s.name)).toEqual(['main', 'impl']);
      expect(view.sessions[1]).toMatchObject({ forkOf: 'main', model: 'm' });
      expect(records.map.get(ID)!.sessions).toHaveLength(2);
      expect(JSON.stringify(view)).not.toContain(TASK_TOKEN);
    });

    it('addSession sends only the given fields, and is 409 for a stopped task', async () => {
      const { service, bridge } = setup();
      await service.addSession(ID, { name: 'x' });
      expect(bridge.addSession).toHaveBeenCalledWith({ name: 'x' });
      const stopped = setup({ records: [record({ lastState: 'stopped' })] });
      await expect(stopped.service.addSession(ID, { name: 'x' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('addSession lets bridge errors through', async () => {
      const { service } = setup({ bridge: { addSession: jest.fn(async () => { throw new BridgeError(409, 'conflict', 'name taken'); }) } });
      await expect(service.addSession(ID, { name: 'main' })).rejects.toBeInstanceOf(BridgeError);
    });

    it('a status read keeps the last messages the poller recorded per session', async () => {
      const { service, records } = setup({
        records: [record({ sessions: [{ name: 'main', state: 'idle', createdAt: '2026-01-01T00:00:00Z', lastMessage: 'kept' }] })],
        bridge: { status: jest.fn(async () => status({ sessions: [bs('main', '2026-01-01T00:00:00Z')] })) },
      });
      const view = await service.get(ID);
      expect(view.sessions[0].lastMessage).toBe('kept');
      expect(records.map.get(ID)!.sessions![0].lastMessage).toBe('kept');
    });

    it('question in session impl puts task in needs-you and answering without id answers it', async () => {
      const waiting = status({
        state: 'waiting', reason: 'question Q9',
        questions: [{ ...q('q9', '2026-01-02'), session: 'impl' }],
        sessions: [bs('main', '2026-01-01T00:00:00Z'), bs('impl', '2026-01-01T00:01:00Z', 'waiting')],
      });
      const { service, bridge } = setup({ bridge: { status: jest.fn(async () => waiting) } });
      const view = await service.get(ID);
      expect(view.section).toBe('needs-you');
      expect(view.questions[0].session).toBe('impl');
      expect(view.sessions.map((s) => s.questions)).toEqual([0, 1]);
      await service.answer(ID, { text: 'yes' });
      expect(bridge.answer).toHaveBeenCalledWith({ text: 'yes', question: 'q9', session: 'impl' });
    });

    it('answer with a session picks that session\'s oldest question', async () => {
      const { service, bridge } = setup({
        bridge: {
          status: jest.fn(async () => status({
            questions: [{ ...q('a', '2026-01-01'), session: 'main' }, { ...q('c', '2026-01-03'), session: 'impl' }, { ...q('b', '2026-01-02'), session: 'impl' }],
          })),
        },
      });
      await service.answer(ID, { text: 'yes', session: 'impl' });
      expect(bridge.answer).toHaveBeenCalledWith({ text: 'yes', question: 'b', session: 'impl' });
    });

    it('answer with a question id and session passes both', async () => {
      const { service, bridge } = setup();
      await service.answer(ID, { text: 'yes', question: 'qx', session: 'impl' });
      expect(bridge.answer).toHaveBeenCalledWith({ text: 'yes', question: 'qx', session: 'impl' });
    });
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

  it.each([
    ['a 503', new BridgeError(503, 'starting', 'starting')],
    ['a 401', new BridgeError(401, 'unauthorized', 'no')],
    ['a plain error', new Error('boom')],
  ])('stop still stops the container when the bridge fails with %s', async (_n, error) => {
    const { service, launcher, records } = setup({ bridge: { stop: jest.fn(async () => { throw error; }) } });
    expect((await service.stop(ID)).state).toBe('stopped');
    expect(launcher.stop).toHaveBeenCalledWith(ID);
    expect(records.map.get(ID)!.lastState).toBe('stopped');
  });

  it('stop works for a record without bridgeUrl', async () => {
    const { service, launcher, factory } = setup({ records: [record({ bridgeUrl: undefined })] });
    factory.mockImplementation(() => { throw new Error('no bridge url'); });
    await service.stop(ID);
    expect(launcher.stop).toHaveBeenCalledWith(ID);
  });

  it('events is 409 when the container is not running', async () => {
    const { service, bridge } = setup({ launcher: notRunning });
    await expect(service.events(ID, 0)).rejects.toBeInstanceOf(ConflictException);
    expect(bridge.events).not.toHaveBeenCalled();
  });

  it('wakes under the same lock as the cap check: two concurrent wakes do not exceed the cap', async () => {
    const a = record({ id: 'T-20260101-aaaa' });
    const b = record({ id: 'T-20260101-bbbb' });
    let running = 1;
    const { service, launcher } = setup({
      records: [a, b],
      launcher: {
        inspect: jest.fn(async () => ({ exists: true, running: false, bridgeUrl: 'x' })),
        countRunning: jest.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return running; }),
        start: jest.fn(async () => { running += 1; }),
      },
    });
    const results = await Promise.allSettled([service.prompt(a.id, 'x'), service.prompt(b.id, 'x')]);
    expect(launcher.start).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('events asks the bridge', async () => {
    const ev = [{ seq: 4 }];
    const { service, bridge } = setup({ bridge: { events: jest.fn(async () => ev) } });
    expect(await service.events(ID, 3)).toBe(ev);
    expect(bridge.events).toHaveBeenCalledWith(3);
  });

  it('events of a session are filtered here: its own and the unnamed task-level ones; unknown session is 404', async () => {
    const all = [{ seq: 1, name: 'main' }, { seq: 2, name: 'second' }, { seq: 3 }];
    const { service, bridge } = setup({ records: [record({ sessions: [{ name: 'second', state: 'idle', createdAt: '2026-01-01T00:00:00.000Z' }] })], bridge: { events: jest.fn(async (since: number) => all.filter((e) => e.seq > since)) } });
    expect((await service.events(ID, 0, 'second')).map((e) => e.seq)).toEqual([2, 3]);
    expect((await service.events(ID, 1, 'main')).map((e) => e.seq)).toEqual([3]);
    expect(bridge.events).toHaveBeenCalledWith(0, 1000);
    await expect(service.events(ID, 3, 'ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('events of a session read on through full bridge pages', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ seq: i + 1, name: 'main' }));
    const page2 = [{ seq: 1001, name: 'second' }];
    const events = jest.fn(async (since: number) => (since === 0 ? page1 : page2));
    const { service } = setup({ records: [record({ sessions: [{ name: 'second', state: 'idle', createdAt: '2026-01-01T00:00:00.000Z' }] })], bridge: { events } });
    expect((await service.events(ID, 0, 'second')).map((e) => e.seq)).toEqual([1001]);
    expect(events).toHaveBeenNthCalledWith(2, 1000, 1000);
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

describe('TasksService announces changes', () => {
  it('announces a created task and its state once the bridge answers', async () => {
    const { service, published } = setup({ records: [] });
    const view = await service.start({ prompt: 'p' });
    expect(published).toEqual([
      { kind: 'task', task: expect.objectContaining({ id: view.id, state: 'starting' }) },
      { kind: 'task', task: expect.objectContaining({ id: view.id, state: 'idle', section: 'in-review' }) },
    ]);
  });

  it('announces a read only when something changed', async () => {
    const { service, published } = setup({ records: [record({ lastStatus: status({ state: 'idle' }) })], bridge: { status: jest.fn(async () => status({ state: 'idle' })) } });
    await service.get(ID);
    expect(published).toEqual([]);
    const other = setup({ bridge: { status: jest.fn(async () => status({ state: 'running' })) } });
    await other.service.get(ID);
    expect(other.published).toEqual([{ kind: 'task', task: expect.objectContaining({ state: 'running', section: 'working' }) }]);
  });

  it('announces stop, close and removal', async () => {
    const stopped = setup();
    await stopped.service.stop(ID);
    expect(stopped.published).toEqual([{ kind: 'task', task: expect.objectContaining({ state: 'stopped', section: 'done' }) }]);
    await stopped.service.remove(ID).catch(() => undefined);

    const closed = setup();
    await closed.service.close(ID);
    expect(closed.published).toEqual([{ kind: 'task', task: expect.objectContaining({ closed: true }) }]);
    await closed.service.remove(ID);
    expect(closed.published[1]).toEqual({ kind: 'removed', id: ID });
  });

  it('notes a running task that a read finds finished, so the poller still reads its last events', async () => {
    const { service, updates } = setup({ records: [record({ lastState: 'running' })] });
    await service.get(ID); // the fake bridge says idle
    expect([...updates.actedIds()]).toEqual([ID]);
  });

  it('notes a new task for the poller', async () => {
    const { service, updates } = setup({ records: [] });
    const view = await service.start({ prompt: 'p' });
    expect([...updates.actedIds()]).toEqual([view.id]);
  });

  it('notes prompt and answer for the poller', async () => {
    const { service, updates } = setup({ records: [record(), record({ id: 'T-20260101-efgh' })] });
    await service.prompt(ID, 'more');
    expect([...updates.actedIds()]).toEqual([ID]);
    await service.answer('T-20260101-efgh', { text: 'yes', question: 'Q1' });
    expect([...updates.actedIds()]).toEqual([ID, 'T-20260101-efgh']);
  });
});

beforeEach(() => { jest.spyOn(Logger.prototype, 'warn').mockImplementation(); });
afterEach(() => jest.restoreAllMocks());

describe('TasksService.readFile', () => {
  it('reads through the launcher with the 64 KB cap by default', async () => {
    const readFile = jest.fn(async () => 'text');
    const { service } = setup({ launcher: { readFile } });
    await expect(service.readFile(ID, 'workflow-draft.yaml')).resolves.toBe('text');
    expect(readFile).toHaveBeenCalledWith(ID, 'workflow-draft.yaml', 64 * 1024);
  });
  it('passes null for a missing file and a given cap', async () => {
    const readFile = jest.fn(async () => null);
    const { service } = setup({ launcher: { readFile } });
    await expect(service.readFile(ID, 'a', 10)).resolves.toBeNull();
    expect(readFile).toHaveBeenCalledWith(ID, 'a', 10);
  });
  it('refuses bad paths before the launcher', async () => {
    const readFile = jest.fn(async () => null);
    const { service } = setup({ launcher: { readFile } });
    await expect(service.readFile(ID, '../x')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.readFile(ID, '/x')).rejects.toBeInstanceOf(BadRequestException);
    expect(readFile).not.toHaveBeenCalled();
  });
  it('is 404 for an unknown task', async () => {
    const { service } = setup();
    await expect(service.readFile('T-nope', 'a')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TasksService.hasFiles', () => {
  it('delegates to the launcher with the task id', async () => {
    const hasFiles = jest.fn(async () => ({ 'a.md': true }));
    const { service } = setup({ launcher: { hasFiles } });
    await expect(service.hasFiles(ID, ['a.md'])).resolves.toEqual({ 'a.md': true });
    expect(hasFiles).toHaveBeenCalledWith(ID, ['a.md']);
  });
  it('refuses bad paths with 400 without calling the launcher', async () => {
    const hasFiles = jest.fn(async () => ({}));
    const { service } = setup({ launcher: { hasFiles } });
    await expect(service.hasFiles(ID, ['../x'])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.hasFiles(ID, ['/x'])).rejects.toBeInstanceOf(BadRequestException);
    expect(hasFiles).not.toHaveBeenCalled();
  });
  it('is 404 for an unknown task', async () => {
    const { service } = setup({ records: [] });
    await expect(service.hasFiles('T-nope', ['a'])).rejects.toBeInstanceOf(NotFoundException);
  });
});
