import { randomBytes } from 'node:crypto';
import { BridgeClient, BridgeError, BridgeEvent, waitForStatus } from '../../src/repository/tasks/bridge/bridge-client';
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
    client = new BridgeClient({ baseUrl: bridgeUrl, taskToken });
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
    const wrong = new BridgeClient({ baseUrl: (await launcher.inspect(taskId)).bridgeUrl, taskToken: 'x'.repeat(32) });
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
