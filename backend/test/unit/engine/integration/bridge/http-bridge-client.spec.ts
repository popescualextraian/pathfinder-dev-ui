import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { HttpBridgeClient } from '../../../../../src/engine/integration/bridge/http-bridge-client';
import {
  BridgeError,
  BridgeEvent,
  BridgeUnreachableError,
  waitForStatus,
} from '../../../../../src/engine/service/bridge-client';

const TOKEN = 'made-up-task-token-aaaaaaaa';

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
}

// A port nothing listens on: bind an ephemeral port, then release it. (Port 1 is not safe: with
// WSL mirrored networking, connects to it hang instead of being refused.)
async function closedPortUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((r) => probe.close(() => r()));
  return `http://127.0.0.1:${port}`;
}

function event(seq: number): BridgeEvent {
  return { seq, ts: '2026-10-16T10:00:00Z', task: 'T-1', session: null, agent: 'claude', type: 'message', data: { n: seq } };
}

describe('HttpBridgeClient', () => {
  let server: Server;
  let wss: WebSocketServer;
  let baseUrl: string;
  let seen: Seen[];
  let upgrades: IncomingMessage[];
  let reply: (req: Seen) => { status: number; body?: unknown; raw?: string; delayMs?: number };
  let liveFrames: BridgeEvent[];
  let closeAfterLive: boolean;

  beforeEach(async () => {
    seen = [];
    upgrades = [];
    liveFrames = [];
    closeAfterLive = true;
    reply = () => ({ status: 200, body: {} });
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const s: Seen = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() };
        seen.push(s);
        const r = reply(s);
        setTimeout(() => {
          res.writeHead(r.status, { 'content-type': 'application/json' });
          res.end(r.raw ?? (r.body === undefined ? '' : JSON.stringify(r.body)));
        }, r.delayMs ?? 0);
      });
    });
    wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      upgrades.push(req);
      wss.handleUpgrade(req, socket, head, (ws) => {
        const since = Number(new URL(req.url ?? '', 'http://x').searchParams.get('since'));
        ws.send(JSON.stringify(event(since + 1)));
        ws.send(JSON.stringify(event(since + 2)));
        setTimeout(() => {
          liveFrames.forEach((e) => ws.send(JSON.stringify(e)));
          if (closeAfterLive) ws.close();
        }, 20);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    wss.clients.forEach((c) => c.terminate());
    await new Promise<void>((r) => server.close(() => r()));
  });

  const client = (extra: Partial<ConstructorParameters<typeof HttpBridgeClient>[0]> = {}) =>
    new HttpBridgeClient({ baseUrl, taskToken: TOKEN, ...extra });

  it('sends the bearer token and the container name as Host header', async () => {
    reply = () => ({ status: 200, body: { state: 'idle', questions: [] } });
    await client({ baseUrl: `http://localhost:${new URL(baseUrl).port}` }).status();
    expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[0].headers.host).toBe(`localhost:${new URL(baseUrl).port}`);
  });

  it('allows overriding the Host header', async () => {
    await client({ hostHeader: 'agentic-ui-task-T-1:8765' }).status();
    expect(seen[0].headers.host).toBe('agentic-ui-task-T-1:8765');
  });

  it('status returns the typed status with questions', async () => {
    const body = {
      task: 'T-1', state: 'waiting', reason: '', branch: 'b', summary: '', seq: 3, allowed_actions: ['push'],
      questions: [{ id: 'q1', source: 'ask', text: 'Which?', options: ['a'], recommendation: null, asked: 'x' }],
    };
    reply = () => ({ status: 200, body });
    const status = await client().status();
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/status' });
    expect(status.state).toBe('waiting');
    expect(status.questions[0].id).toBe('q1');
  });

  it('events asks for the status view only when told to', async () => {
    reply = () => ({ status: 200, raw: '' });
    await client().events(7, 1000, 'status');
    await client().events(7, 50);
    expect(seen[0].url).toBe('/events?since=7&limit=1000&view=status');
    expect(seen[1].url).toBe('/events?since=7&limit=50');
  });

  it('prompt posts the text', async () => {
    reply = () => ({ status: 202, body: { state: 'running', questions: [] } });
    const status = await client().prompt('hello');
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/prompt' });
    expect(seen[0].headers['content-type']).toContain('application/json');
    expect(JSON.parse(seen[0].body)).toEqual({ text: 'hello' });
    expect(status.state).toBe('running');
  });

  it('answer posts text, question and grant', async () => {
    reply = () => ({ status: 202, body: { state: 'running', questions: [] } });
    await client().answer({ text: 'yes', question: 'q1', grant: ['push'] });
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/answer' });
    expect(JSON.parse(seen[0].body)).toEqual({ text: 'yes', question: 'q1', grant: ['push'] });
  });

  it('answer omits absent fields', async () => {
    reply = () => ({ status: 202, body: { state: 'running', questions: [] } });
    await client().answer({ text: 'yes' });
    expect(JSON.parse(seen[0].body)).toEqual({ text: 'yes' });
  });

  it('cancel and stop post to their routes', async () => {
    reply = () => ({ status: 202, body: { state: 'idle', questions: [] } });
    await client().cancel();
    await client().stop();
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(['POST /cancel', 'POST /stop']);
  });

  it('prompt, answer and cancel carry the session in the body when given', async () => {
    reply = () => ({ status: 202, body: { state: 'running', questions: [] } });
    await client().prompt('hi', 'second');
    await client().answer({ text: 'yes', question: 'q1', session: 'second' });
    await client().cancel('second');
    expect(JSON.parse(seen[0].body)).toEqual({ text: 'hi', session: 'second' });
    expect(JSON.parse(seen[1].body)).toEqual({ text: 'yes', question: 'q1', session: 'second' });
    expect(seen[2]).toMatchObject({ method: 'POST', url: '/cancel' });
    expect(JSON.parse(seen[2].body)).toEqual({ session: 'second' });
  });

  it('sessions gets the session list', async () => {
    reply = () => ({ status: 200, body: [{ name: 'main', state: 'idle', fork_of: null }] });
    const sessions = await client().sessions();
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/sessions' });
    expect(sessions[0].name).toBe('main');
  });

  it('addSession posts name and only the given options', async () => {
    reply = () => ({ status: 201, body: { name: 'second', state: 'idle', fork_of: 'main' } });
    const created = await client().addSession({ name: 'second', model: 'opus', fork: 'main', text: 'go' });
    await client().addSession({ name: 'third' });
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/sessions' });
    expect(JSON.parse(seen[0].body)).toEqual({ name: 'second', model: 'opus', fork: 'main', text: 'go' });
    expect(JSON.parse(seen[1].body)).toEqual({ name: 'third' });
    expect(created.fork_of).toBe('main');
  });

  it('addSession maps a name conflict to BridgeError 409', async () => {
    reply = () => ({ status: 409, body: { error: { code: 'conflict', message: 'name taken' } } });
    await expect(client().addSession({ name: 'main' })).rejects.toMatchObject({ status: 409 });
  });

  it('events filters by session in the query', async () => {
    reply = () => ({ status: 200, raw: '' });
    await client().events(2, 10, 'status', 'second');
    await client().events(2, undefined, undefined, 'a b');
    expect(seen[0].url).toBe('/events?since=2&limit=10&view=status&session=second');
    expect(seen[1].url).toBe('/events?since=2&session=a%20b');
  });

  it('events parses NDJSON and passes since and limit', async () => {
    reply = () => ({ status: 200, raw: `${JSON.stringify(event(4))}\n${JSON.stringify(event(5))}\n` });
    const events = await client().events(3, 50);
    expect(seen[0].url).toBe('/events?since=3&limit=50');
    expect(events.map((e) => e.seq)).toEqual([4, 5]);
  });

  it('events returns an empty array for an empty body', async () => {
    reply = () => ({ status: 200, raw: '' });
    expect(await client().events(0)).toEqual([]);
    expect(seen[0].url).toBe('/events?since=0');
  });

  it('maps an error body to BridgeError', async () => {
    reply = () => ({ status: 409, body: { error: { code: 'conflict', message: 'no turn' } } });
    const error = await client().cancel().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ status: 409, code: 'conflict', message: 'no turn' });
  });

  it('maps 503 starting to BridgeError', async () => {
    reply = () => ({ status: 503, body: { error: { code: 'starting', message: 'the bridge is starting' } } });
    await expect(client().status()).rejects.toMatchObject({ status: 503, code: 'starting' });
  });

  it('maps a non-JSON error body to BridgeError with a generic code', async () => {
    reply = () => ({ status: 500, raw: '<html>boom</html>' });
    await expect(client().status()).rejects.toMatchObject({ status: 500, code: 'internal' });
  });

  it('never puts the token in error messages', async () => {
    reply = () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'unauthorized' } } });
    const error = (await client().status().catch((e: unknown) => e)) as Error;
    expect(error.message + String(error.stack ?? '').split('\n')[0]).not.toContain(TOKEN);
    const dead = new HttpBridgeClient({ baseUrl: await closedPortUrl(), taskToken: TOKEN });
    const unreachable = (await dead.status().catch((e: unknown) => e)) as Error;
    expect(JSON.stringify(unreachable.message)).not.toContain(TOKEN);
  });

  it('maps connection refused to BridgeUnreachableError', async () => {
    const dead = new HttpBridgeClient({ baseUrl: await closedPortUrl(), taskToken: TOKEN });
    await expect(dead.status()).rejects.toBeInstanceOf(BridgeUnreachableError);
  });

  it('maps DNS failure to BridgeUnreachableError', async () => {
    const bad = new HttpBridgeClient({ baseUrl: 'http://no-such-host.invalid:8765', taskToken: TOKEN });
    await expect(bad.status()).rejects.toBeInstanceOf(BridgeUnreachableError);
  });

  it('maps a request timeout to BridgeUnreachableError', async () => {
    reply = () => ({ status: 200, body: {}, delayMs: 300 });
    await expect(client({ timeoutMs: 50 }).status()).rejects.toBeInstanceOf(BridgeUnreachableError);
  });

  it('maps a reset connection to BridgeUnreachableError', async () => {
    server.removeAllListeners('request');
    server.on('request', (req) => req.socket.destroy());
    await expect(client().status()).rejects.toBeInstanceOf(BridgeUnreachableError);
  });

  describe('apps', () => {
    const app = { name: 'web', state: 'running', ports: [3000], url: '/', since: '2026-10-20T10:00:00Z' };

    it('lists the apps', async () => {
      reply = () => ({ status: 200, body: [app] });
      expect(await client().apps()).toEqual([app]);
      expect(seen[0]).toMatchObject({ method: 'GET', url: '/apps' });
      expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('relays start, stop and restart and returns the app', async () => {
      reply = () => ({ status: 202, body: app });
      for (const action of ['start', 'stop', 'restart'] as const) {
        expect(await client().appAction('web', action)).toEqual(app);
      }
      expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual(['POST /apps/web/start', 'POST /apps/web/stop', 'POST /apps/web/restart']);
    });

    it('reads the logs as lines', async () => {
      reply = () => ({ status: 200, body: { lines: ['a', 'b'] } });
      expect(await client().appLogs('web', 50)).toEqual(['a', 'b']);
      expect(seen[0]).toMatchObject({ method: 'GET', url: '/apps/web/logs?lines=50' });
    });

    it('waits long for start and restart, briefly for stop and the reads', async () => {
      reply = () => ({ status: 202, body: app, delayMs: 200 });
      await expect(client({ timeoutMs: 50 }).appAction('web', 'start')).resolves.toEqual(app);
      await expect(client({ timeoutMs: 50 }).appAction('web', 'restart')).resolves.toEqual(app);
      await expect(client({ timeoutMs: 50 }).appAction('web', 'stop')).rejects.toBeInstanceOf(BridgeUnreachableError);
      await expect(client({ timeoutMs: 50 }).apps()).rejects.toBeInstanceOf(BridgeUnreachableError);
    });

    it('maps bridge errors and malformed bodies', async () => {
      reply = () => ({ status: 404, body: { error: { code: 'not_found', message: 'No app x' } } });
      await expect(client().appAction('x', 'start')).rejects.toMatchObject({ status: 404, code: 'not_found' });
      reply = () => ({ status: 200, body: { nope: 1 } });
      await expect(client().apps()).rejects.toBeInstanceOf(BridgeUnreachableError);
      await expect(client().appLogs('web', 5)).rejects.toBeInstanceOf(BridgeUnreachableError);
    });
  });

  describe('eventStream', () => {
    it('yields backlog then live events and ends on close', async () => {
      liveFrames = [event(12)];
      const seqs: number[] = [];
      for await (const e of client().eventStream(10)) seqs.push(e.seq);
      expect(seqs).toEqual([11, 12, 12]);
      expect(upgrades[0].url).toBe('/events?since=10');
      expect(upgrades[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(upgrades[0].headers.host).toBe(new URL(baseUrl).host);
    });

    it('sends the overridden Host header', async () => {
      for await (const e of client({ hostHeader: 'task-box:8765' }).eventStream(0)) void e;
      expect(upgrades[0].headers.host).toBe('task-box:8765');
    });

    it('ends when aborted', async () => {
      closeAfterLive = false;
      const controller = new AbortController();
      const seqs: number[] = [];
      for await (const e of client().eventStream(0, controller.signal)) {
        seqs.push(e.seq);
        if (seqs.length === 2) controller.abort();
      }
      expect(seqs).toEqual([1, 2]);
    });

    it('ends at once when already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const seqs: number[] = [];
      for await (const e of client().eventStream(0, controller.signal)) seqs.push(e.seq);
      expect(seqs).toEqual([]);
    });

    it('rejects with BridgeError when the upgrade is refused', async () => {
      server.removeAllListeners('upgrade');
      server.on('upgrade', (_req, socket) => {
        socket.write('HTTP/1.1 401 Refused\r\nConnection: close\r\n\r\n');
        socket.destroy();
      });
      const run = async () => { for await (const e of client().eventStream(0)) void e; };
      await expect(run()).rejects.toMatchObject({ status: 401 });
    });

    it('rejects with BridgeUnreachableError when nothing listens', async () => {
      const dead = new HttpBridgeClient({ baseUrl: await closedPortUrl(), taskToken: TOKEN });
      const run = async () => { for await (const e of dead.eventStream(0)) void e; };
      await expect(run()).rejects.toBeInstanceOf(BridgeUnreachableError);
    });
  });

  describe('waitForStatus', () => {
    it('polls through 503 starting until the bridge answers', async () => {
      let calls = 0;
      reply = () =>
        ++calls < 3
          ? { status: 503, body: { error: { code: 'starting', message: 'starting' } } }
          : { status: 200, body: { state: 'idle', questions: [] } };
      const status = await waitForStatus(client(), { timeoutMs: 2000, intervalMs: 10 });
      expect(status.state).toBe('idle');
      expect(calls).toBe(3);
    });

    it('treats unreachable as not yet', async () => {
      const port = new URL(baseUrl).port;
      await new Promise<void>((r) => server.close(() => r()));
      setTimeout(() => server.listen(Number(port), '127.0.0.1'), 80);
      reply = () => ({ status: 200, body: { state: 'idle', questions: [] } });
      const status = await waitForStatus(client(), { timeoutMs: 3000, intervalMs: 20 });
      expect(status.state).toBe('idle');
    });

    it('fails fast on other bridge errors', async () => {
      reply = () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'unauthorized' } } });
      await expect(waitForStatus(client(), { timeoutMs: 1000, intervalMs: 10 })).rejects.toMatchObject({ status: 401 });
    });

    it('gives up after the timeout', async () => {
      reply = () => ({ status: 503, body: { error: { code: 'starting', message: 'starting' } } });
      await expect(waitForStatus(client(), { timeoutMs: 100, intervalMs: 10 })).rejects.toThrow(/did not answer/);
    });
  });

  describe('malformed payloads', () => {
    it('status with a non-JSON 200 body is BridgeUnreachableError', async () => {
      reply = () => ({ status: 200, raw: '<html>oops</html>' });
      await expect(new HttpBridgeClient({ baseUrl, taskToken: TOKEN }).status()).rejects.toBeInstanceOf(BridgeUnreachableError);
    });

    it('events with a malformed line is BridgeUnreachableError', async () => {
      reply = () => ({ status: 200, raw: '{"seq":1}\nnot json\n' });
      await expect(new HttpBridgeClient({ baseUrl, taskToken: TOKEN }).events(0)).rejects.toBeInstanceOf(BridgeUnreachableError);
    });
  });
});
