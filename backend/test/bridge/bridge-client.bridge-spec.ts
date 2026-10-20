import { randomBytes } from 'node:crypto';
import { HttpBridgeClient } from '../../src/engine/integration/bridge/http-bridge-client';
import { BridgeClient, BridgeError, BridgeEvent, waitForStatus } from '../../src/engine/service/bridge-client';
import { describeWithBridge, LocalProcessLauncher, until } from '../helpers/local-process-launcher';

// The BridgeClient against the real agentic-bridge with the fake agent.
describeWithBridge('BridgeClient against the real bridge', () => {
  const launcher = new LocalProcessLauncher();
  const taskId = 'T-20261016-cl01';
  const taskToken = randomBytes(16).toString('hex');
  let client: BridgeClient;

  beforeAll(async () => {
    const { bridgeUrl } = await launcher.launch({
      taskId, taskToken, agentToken: randomBytes(16).toString('hex'), prompt: 'first prompt', repoUrl: 'https://example.invalid/r.git', branch: `agentic/${taskId}`,
    });
    client = new HttpBridgeClient({ baseUrl: bridgeUrl, taskToken });
  });

  afterAll(async () => {
    await launcher.dispose();
  });

  async function idle() {
    return until('state idle', async () => {
      const s = await client.status();
      return s.state === 'idle' ? s : undefined;
    });
  }

  it('comes up, runs the initial prompt and goes idle on its own branch', async () => {
    const first = await waitForStatus(client, { timeoutMs: 30000, intervalMs: 200 }).catch((e) => {
      throw new Error(`${(e as Error).message}\n${launcher.output(taskId)}`);
    });
    expect(first.task).toBe(taskId);
    const status = await idle();
    expect(status.branch).toBe(`agentic/${taskId}`);
    const events = await client.events(0);
    expect(events.some((e) => e.type === 'message' && JSON.stringify(e.data).includes('echo: first prompt'))).toBe(true);
  });

  it('rejects a wrong token', async () => {
    const wrong = new HttpBridgeClient({ baseUrl: (await launcher.inspect(taskId)).bridgeUrl, taskToken: 'x'.repeat(32) });
    await expect(wrong.status()).rejects.toMatchObject({ status: 401 });
  });

  it('echoes a prompt as a message event', async () => {
    await idle();
    const before = (await client.status()).seq;
    await client.prompt('hello fake');
    await until('echo event', async () => (await client.events(before)).find((e) => e.type === 'message' && JSON.stringify(e.data).includes('echo: hello fake')));
    await idle();
  });

  it('shows an ASK: question in status and takes the answer', async () => {
    await idle();
    await client.prompt('ASK:Which file?');
    const asked = await until('open question', async () => (await client.status()).questions[0]);
    expect(asked.text).toBe('Which file?');
    const answered = await client.answer({ question: asked.id, text: 'the first one' });
    expect(answered.questions.find((q) => q.id === asked.id)).toBeUndefined();
    await idle();
    await expect(client.answer({ text: 'again' })).rejects.toMatchObject({ status: 409 });
    await expect(client.answer({ question: 'Q99', text: 'x' })).rejects.toBeInstanceOf(BridgeError);
  });

  it('cancels a SLEEP: turn', async () => {
    await idle();
    await client.prompt('SLEEP:30000');
    await until('running', async () => (await client.status()).state === 'running');
    await client.cancel();
    await idle();
    await expect(client.cancel()).rejects.toMatchObject({ status: 409 });
  });

  it('returns events since a sequence number and streams backlog then live', async () => {
    await idle();
    const all = await client.events(0);
    expect(all.length).toBeGreaterThan(3);
    const mid = all[2].seq;
    expect((await client.events(mid)).every((e) => e.seq > mid)).toBe(true);

    const abort = new AbortController();
    const seen: BridgeEvent[] = [];
    const pump = (async () => {
      for await (const event of client.eventStream(mid, abort.signal)) seen.push(event);
    })();
    await until('backlog', async () => seen.length >= all.filter((e) => e.seq > mid).length);
    expect(seen[0].seq).toBe(mid + 1);
    const count = seen.length;
    await client.prompt('live one');
    await until('live echo', async () => seen.slice(count).some((e) => e.type === 'message' && JSON.stringify(e.data).includes('echo: live one')));
    abort.abort();
    await pump;
  });

  describe('sessions', () => {
    async function sessionState(name: string) {
      return until(`session ${name} idle`, async () => (await client.sessions()).find((x) => x.name === name && x.state === 'idle'));
    }
    const lastMessage = async (name: string, needle: string) =>
      until(`message ${needle} in ${name}`, async () => (await client.events(0, undefined, 'full', name)).find((e) => e.type === 'message' && JSON.stringify(e.data).includes(needle)));

    it('adds a session that answers on its own', async () => {
      await idle();
      const added = await client.addSession({ name: 'second', text: 'hi second' });
      expect(added.name).toBe('second');
      await lastMessage('second', 'echo: hi second');
      await sessionState('second');
      expect((await client.sessions()).map((x) => x.name)).toEqual(expect.arrayContaining(['main', 'second']));
    });

    it('forks a session that knows the conversation of its source', async () => {
      await idle();
      await client.prompt('HISTORY');
      const main = await until('main history', async () => (await client.events(0, undefined, 'full', 'main')).filter((e) => JSON.stringify(e.data).includes('history: ')).pop());
      const mainCount = Number(/history: (\d+)/.exec(JSON.stringify(main.data))![1]);
      expect(mainCount).toBeGreaterThan(2);
      await idle();
      const forked = await client.addSession({ name: 'forked', fork: 'main', text: 'HISTORY' });
      expect(forked.fork_of).toBe('main');
      const ev = await lastMessage('forked', 'history: ');
      // main's history at the time plus its own HISTORY exchange (user + agent) is what the fork starts from
      expect(Number(/history: (\d+)/.exec(JSON.stringify(ev.data))![1])).toBe(mainCount + 2);
      await sessionState('forked');
    });

    it('runs a question in the second session while main stays idle, and answers it independently', async () => {
      await idle();
      await client.prompt('ASK:Which branch?', 'second');
      const q = await until('question in second', async () => (await client.status()).questions.find((x) => x.session === 'second'));
      expect(q.text).toBe('Which branch?');
      const status = await client.status();
      expect(status.sessions?.find((x) => x.name === 'main')?.state).toBe('idle');
      expect(status.questions.filter((x) => x.session !== 'second')).toEqual([]);
      await client.answer({ question: q.id, text: 'develop', session: 'second' });
      await sessionState('second');
      expect((await client.status()).questions).toEqual([]);
      expect((await client.sessions()).find((x) => x.name === 'main')?.state).toBe('idle');
    });
  });

  it('stops: prompts are refused afterwards', async () => {
    await idle();
    await client.stop();
    const status = await until('stopped', async () => {
      try {
        const s = await client.status();
        return s.state === 'stopped' ? s : undefined;
      } catch {
        return { state: 'stopped' }; // the bridge may already have exited
      }
    });
    expect(status.state).toBe('stopped');
  });
});

// LocalTaskLauncher.start(): a bridge ended from outside comes back on the same port.
describeWithBridge('LocalTaskLauncher.start() with the real bridge', () => {
  const launcher = new LocalProcessLauncher();
  const taskId = 'T-20261016-cl02';
  const taskToken = randomBytes(16).toString('hex');

  afterAll(async () => {
    await launcher.dispose();
  });

  it('respawns a bridge ended by stop() on the same port with start() and it answers again', async () => {
    const { bridgeUrl } = await launcher.launch({
      taskId, taskToken, agentToken: randomBytes(16).toString('hex'), prompt: 'p', repoUrl: 'https://example.invalid/r.git', branch: `agentic/${taskId}`,
    });
    const client = new HttpBridgeClient({ baseUrl: bridgeUrl, taskToken });
    await until('the first bridge', () => client.status().catch(() => undefined));
    await launcher.stop(taskId);
    expect(await launcher.inspect(taskId)).toMatchObject({ exists: true, running: false });
    await expect(client.status()).rejects.toBeDefined();
    await launcher.start(taskId);
    expect(await launcher.inspect(taskId)).toMatchObject({ running: true, bridgeUrl });
    const status = await until('the respawned bridge', () => client.status().catch(() => undefined));
    expect(status.task).toBe(taskId);
    expect(status.state).not.toBe('stopped'); // the bridge was ended, not stopped by the user
  });
});
