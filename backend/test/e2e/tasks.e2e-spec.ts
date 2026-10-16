import { INestApplication } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import request from 'supertest';
import { FakeBridge } from '../helpers/fake-bridge';
import { FakeLauncher } from '../helpers/fake-launcher';
import { FAKE_GH_TOKEN, FAKE_OAUTH_TOKEN } from '../helpers/test-env';
import { createApp } from './create-app';

describe('tasks REST API (e2e)', () => {
  let app: INestApplication;
  let bridge: FakeBridge;
  let launcher: FakeLauncher;
  let dataDir: string;
  // Everything the API ever sent, and every secret that must not be in it.
  const sent: string[] = [];
  const secrets = new Set<string>([FAKE_GH_TOKEN, FAKE_OAUTH_TOKEN]);

  const api = () => request(app.getHttpServer());
  const record = <T extends request.Response>(res: T): T => {
    sent.push(JSON.stringify(res.headers) + res.text);
    return res;
  };
  const rememberTokens = () => {
    for (const name of readdirSync(dataDir)) {
      if (!name.endsWith('.json')) continue;
      const rec = JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as { taskToken: string; agentToken: string };
      secrets.add(rec.taskToken);
      secrets.add(rec.agentToken);
    }
  };
  const post = async (path: string, body?: object) => record(await api().post(path).send(body));
  const get = async (path: string) => record(await api().get(path));
  const start = async (body: object = { prompt: 'fix the bug' }) => {
    const res = await post('/api/tasks', body);
    rememberTokens();
    return res;
  };

  beforeEach(async () => {
    bridge = new FakeBridge();
    await bridge.start();
    launcher = new FakeLauncher(bridge.url);
    ({ app, dataDir } = await createApp({ launcher, maxRunning: 2 }));
  });
  afterEach(async () => {
    await app.close();
    await bridge.stop();
  });


  describe('starting', () => {
    it('creates a task: 201, the view without tokens, a launch with defaults', async () => {
      const res = await start({ prompt: 'fix the bug', repoRef: 'main', model: 'claude-sonnet-4-5' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.stringMatching(/^T-\d{8}-[a-z0-9]{4}$/),
        prompt: 'fix the bug',
        repoUrl: 'https://github.com/acme/default.git',
        repoRef: 'main',
        model: 'claude-sonnet-4-5',
        state: 'idle',
      });
      expect(res.body).not.toHaveProperty('taskToken');
      expect(res.body).not.toHaveProperty('agentToken');
      expect(launcher.specs[0].branch).toBe(`agentic/${res.body.id}`);
      expect(launcher.specs).toHaveLength(1);
      expect(bridge.requests[0].auth).toBe(`Bearer ${launcher.specs[0].taskToken}`);
    });

    it('takes an explicit https repository', async () => {
      const res = await start({ prompt: 'p', repoUrl: 'https://github.com/other/repo.git' });
      expect(res.status).toBe(201);
      expect(res.body.repoUrl).toBe('https://github.com/other/repo.git');
    });

    it.each([
      'https://attacker.example/r.git',
      'https://github.com.evil.example/r.git',
    ])('refuses the repository host of %s with 400 and launches nothing', async (repoUrl) => {
      const res = await start({ prompt: 'p', repoUrl });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/allowed repository host/);
      expect(launcher.specs).toHaveLength(0);
    });

    it.each([
      ['no prompt', {}],
      ['blank prompt', { prompt: '  ' }],
      ['file url', { prompt: 'p', repoUrl: 'file:///etc' }],
      ['ssh url', { prompt: 'p', repoUrl: 'ssh://git@github.com/o/r' }],
      ['http url', { prompt: 'p', repoUrl: 'http://github.com/o/r' }],
      ['credentials in url', { prompt: 'p', repoUrl: 'https://u:pw@github.com/o/r' }],
      ['bad ref', { prompt: 'p', repoRef: '--upload-pack=x' }],
      ['bad model', { prompt: 'p', model: 'a b' }],
    ])('rejects %s with 400 and launches nothing', async (_name, body) => {
      const res = await start(body);
      expect(res.status).toBe(400);
      expect(launcher.specs).toHaveLength(0);
    });

    it('refuses beyond the cap with 409', async () => {
      expect((await start()).status).toBe(201);
      expect((await start()).status).toBe(201);
      const res = await start();
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/At most 2/);
    });
  });

  describe('reading', () => {
    it('lists tasks and gets one with the bridge status', async () => {
      const { body: task } = await start();
      bridge.ask('q-1', 'Which file?', '2026-10-16T10:00:00Z');

      const list = await get('/api/tasks');
      expect(list.status).toBe(200);
      expect(list.body.map((t: { id: string }) => t.id)).toEqual([task.id]);

      const one = await get(`/api/tasks/${task.id}`);
      expect(one.status).toBe(200);
      expect(one.body).toMatchObject({ id: task.id, state: 'waiting', summary: 'fake summary' });
      expect(one.body).not.toHaveProperty('bridgeUrl');
      expect(one.body).not.toHaveProperty('containerName');
      expect(one.body.questions).toEqual([expect.objectContaining({ id: 'q-1', text: 'Which file?' })]);
    });

    it('answers 404 for an unknown id on every route', async () => {
      const id = 'T-20260101-zzzz';
      for (const res of [
        await get(`/api/tasks/${id}`),
        await get(`/api/tasks/${id}/events`),
        await get(`/api/tasks/${id}/events/stream`),
        await post(`/api/tasks/${id}/prompt`, { text: 'x' }),
        await post(`/api/tasks/${id}/answer`, { text: 'x' }),
        await post(`/api/tasks/${id}/cancel`),
        await post(`/api/tasks/${id}/stop`),
        record(await api().delete(`/api/tasks/${id}`)),
        await get('/api/tasks/not-an-id'),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ statusCode: 404 });
      }
    });
  });

  describe('commands', () => {
    it('sends a prompt: 202 with the task, text reaches the bridge', async () => {
      const { body: task } = await start();
      const res = await post(`/api/tasks/${task.id}/prompt`, { text: 'now do more' });
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ id: task.id, state: 'running' });
      expect(bridge.requests.find((r) => r.url === '/prompt')?.body).toEqual({ text: 'now do more' });
    });

    it('validates prompt and answer bodies', async () => {
      const { body: task } = await start();
      expect((await post(`/api/tasks/${task.id}/prompt`, { text: '' })).status).toBe(400);
      expect((await post(`/api/tasks/${task.id}/prompt`, {})).status).toBe(400);
      expect((await post(`/api/tasks/${task.id}/answer`, { text: 'x', question: 5 })).status).toBe(400);
    });

    it('answers the oldest open question by default', async () => {
      const { body: task } = await start();
      bridge.ask('q-new', 'second', '2026-10-16T11:00:00Z');
      bridge.ask('q-old', 'first', '2026-10-16T10:00:00Z');
      const res = await post(`/api/tasks/${task.id}/answer`, { text: 'yes' });
      expect(res.status).toBe(202);
      expect(bridge.requests.find((r) => r.url === '/answer')?.body).toEqual({ question: 'q-old', text: 'yes' });
    });

    it('answers an explicit question', async () => {
      const { body: task } = await start();
      bridge.ask('q-1', 'first', '2026-10-16T10:00:00Z');
      bridge.ask('q-2', 'second', '2026-10-16T11:00:00Z');
      const res = await post(`/api/tasks/${task.id}/answer`, { text: 'no', question: 'q-2' });
      expect(res.status).toBe(202);
      expect(bridge.requests.find((r) => r.url === '/answer')?.body).toEqual({ question: 'q-2', text: 'no' });
      expect(res.body.questions.map((q: { id: string }) => q.id)).toEqual(['q-1']);
    });

    it('cancels a running turn', async () => {
      const { body: task } = await start();
      await post(`/api/tasks/${task.id}/prompt`, { text: 'long job' });
      const res = await post(`/api/tasks/${task.id}/cancel`);
      expect(res.status).toBe(202);
      expect(res.body.state).toBe('idle');
    });

    it('stops: bridge stop, container stopped, state stopped', async () => {
      const { body: task } = await start();
      const res = await post(`/api/tasks/${task.id}/stop`);
      expect(res.status).toBe(202);
      expect(res.body.state).toBe('stopped');
      expect(bridge.requests.some((r) => r.url === '/stop')).toBe(true);
      expect(launcher.containers.get(task.id)?.running).toBe(false);
    });
  });

  describe('a stopped task', () => {
    it('refuses prompt and answer with 409 at once and does not start the container', async () => {
      const { body: task } = await start();
      await post(`/api/tasks/${task.id}/stop`);
      const before = bridge.requests.length;
      for (const res of [
        await post(`/api/tasks/${task.id}/prompt`, { text: 'more' }),
        await post(`/api/tasks/${task.id}/answer`, { text: 'yes' }),
      ]) {
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/task is stopped/);
      }
      expect(launcher.containers.get(task.id)?.running).toBe(false);
      expect(bridge.requests.slice(before)).toEqual([]);
    });

    it('refuses a prompt with 409 when the running bridge says stopped', async () => {
      const { body: task } = await start();
      bridge.state = 'stopped';
      const res = await post(`/api/tasks/${task.id}/prompt`, { text: 'more' });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/task is stopped/);
      expect(bridge.requests.some((r) => r.url === '/prompt')).toBe(false);
    });

    it('still wakes a container stopped outside the engine (docker stop) while idle', async () => {
      const { body: task } = await start();
      launcher.containers.get(task.id)!.running = false; // docker stop
      expect((await get(`/api/tasks/${task.id}`)).body.state).toBe('suspended');
      const res = await post(`/api/tasks/${task.id}/prompt`, { text: 'more' });
      expect(res.status).toBe(202);
      expect(launcher.containers.get(task.id)?.running).toBe(true);
      expect(bridge.requests.find((r) => r.url === '/prompt')?.body).toEqual({ text: 'more' });
    });
  });

  describe('events', () => {
    it('lists events as a JSON array, honouring since', async () => {
      const { body: task } = await start();
      bridge.emit('message', { n: 1 });
      bridge.emit('message', { n: 2 });
      bridge.emit('message', { n: 3 });
      const all = await get(`/api/tasks/${task.id}/events`);
      expect(all.status).toBe(200);
      expect(all.body.map((e: { seq: number }) => e.seq)).toEqual([1, 2, 3]);
      const after = await get(`/api/tasks/${task.id}/events?since=2`);
      expect(after.body.map((e: { seq: number }) => e.seq)).toEqual([3]);
    });

    it.each(['-1', 'abc', '1.5'])('rejects since=%s with 400', async (since) => {
      const { body: task } = await start();
      expect((await get(`/api/tasks/${task.id}/events?since=${since}`)).status).toBe(400);
      expect((await get(`/api/tasks/${task.id}/events/stream?since=${since}`)).status).toBe(400);
    });

    // Raw HTTP: reads the SSE body until `done(text)` is true, then disconnects.
    const readSse = (path: string, headers: Record<string, string>, done: (text: string) => boolean, onData?: (text: string) => void) =>
      new Promise<{ status: number; type?: string; text: string }>((resolve, reject) => {
        const { port } = app.getHttpServer().address() as { port: number };
        const req = httpRequest({ host: '127.0.0.1', port, path, headers: { Accept: 'text/event-stream', ...headers } }, (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            text += chunk;
            onData?.(text);
            if (res.statusCode !== 200 || done(text)) {
              sent.push(text);
              req.destroy();
              resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], text });
            }
          });
          res.on('end', () => {
            sent.push(text);
            resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], text });
          });
        });
        req.on('error', (e) => ((e as NodeJS.ErrnoException).code === 'ECONNRESET' ? undefined : reject(e)));
        req.setTimeout(5000, () => reject(new Error('SSE timeout')));
        req.end();
      });

    const parse = (text: string) =>
      text.split('\n\n').filter((b) => b.includes('data:')).map((block) => ({
        id: /^id: (.*)$/m.exec(block)?.[1],
        data: JSON.parse(/^data: (.*)$/m.exec(block)![1]),
      }));

    it('streams the backlog, then live events, with seq as SSE id', async () => {
      const { body: task } = await start();
      bridge.emit('message', { n: 1 });
      bridge.emit('message', { n: 2 });
      let emitted = false;
      const res = await readSse(
        `/api/tasks/${task.id}/events/stream?since=0`, {},
        (text) => parse(text).length >= 3,
        (text) => {
          if (!emitted && parse(text).length >= 2) {
            emitted = true;
            bridge.emit('message', { n: 3, live: true });
          }
        },
      );
      expect(res.status).toBe(200);
      expect(res.type).toMatch(/text\/event-stream/);
      const events = parse(res.text);
      expect(events.map((e) => e.id)).toEqual(['1', '2', '3']);
      expect(events.map((e) => e.data.seq)).toEqual([1, 2, 3]);
      expect(events[2].data.data).toEqual({ n: 3, live: true });
    });

    it('resumes from since and from Last-Event-ID, and unsubscribes from the bridge on disconnect', async () => {
      const { body: task } = await start();
      for (let n = 1; n <= 4; n++) bridge.emit('message', { n });
      const viaQuery = await readSse(`/api/tasks/${task.id}/events/stream?since=3`, {}, (t) => parse(t).length >= 1);
      expect(parse(viaQuery.text).map((e) => e.id)).toEqual(['4']);
      const viaHeader = await readSse(`/api/tasks/${task.id}/events/stream`, { 'Last-Event-ID': '2' }, (t) => parse(t).length >= 2);
      expect(parse(viaHeader.text).map((e) => e.id)).toEqual(['3', '4']);
      // A reconnecting EventSource repeats its original since and adds Last-Event-ID: the header wins.
      const both = await readSse(`/api/tasks/${task.id}/events/stream?since=0`, { 'Last-Event-ID': '3' }, (t) => parse(t).length >= 1);
      expect(parse(both.text).map((e) => e.id)).toEqual(['4']);
      for (let i = 0; i < 50 && bridge.liveClients > 0; i++) await new Promise((r) => setTimeout(r, 20));
      expect(bridge.liveClients).toBe(0);
    });
  });

  describe('removing', () => {
    it('refuses with 409 unless stopped, then removes: 204 and 404 afterwards', async () => {
      const { body: task } = await start();
      const refused = record(await api().delete(`/api/tasks/${task.id}`));
      expect(refused.status).toBe(409);
      expect(launcher.containers.has(task.id)).toBe(true);

      await post(`/api/tasks/${task.id}/stop`);
      const removed = record(await api().delete(`/api/tasks/${task.id}`));
      expect(removed.status).toBe(204);
      expect(launcher.containers.has(task.id)).toBe(false);
      expect((await get(`/api/tasks/${task.id}`)).status).toBe(404);
      expect((await get('/api/tasks')).body).toEqual([]);
    });
  });

  describe('bridge errors', () => {
    it('maps 409 from the bridge with its message', async () => {
      const { body: task } = await start();
      const res = await post(`/api/tasks/${task.id}/cancel`); // idle: nothing to cancel
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ statusCode: 409, message: 'No turn to cancel' });
    });

    it('maps 404 from the bridge (unknown question)', async () => {
      const { body: task } = await start();
      bridge.ask('q-1', 'x', '2026-10-16T10:00:00Z');
      const res = await post(`/api/tasks/${task.id}/answer`, { text: 'a', question: 'q-nope' });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/Unknown question/);
    });

    it('maps 400 from the bridge', async () => {
      const { body: task } = await start();
      bridge.failNext = { status: 400, code: 'bad_request', message: 'text too long for bridge', route: 'POST /prompt' };
      const res = await post(`/api/tasks/${task.id}/prompt`, { text: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('text too long for bridge');
    });

    it('maps a rejected token (401) to 502 without detail', async () => {
      const { body: task } = await start();
      bridge.failNext = { status: 401, code: 'unauthorized', message: 'bad token', route: 'POST /prompt' };
      const res = await post(`/api/tasks/${task.id}/prompt`, { text: 'x' });
      expect(res.status).toBe(502);
      expect(res.body.message).not.toMatch(/bad token/);
    });

    it('answers 502 when the bridge is unreachable, shows last known state on GET', async () => {
      const { body: task } = await start();
      await bridge.stop();
      const res = await post(`/api/tasks/${task.id}/prompt`, { text: 'x' });
      expect(res.status).toBe(502);
      expect(res.body.message).toBe('The task bridge is not reachable');
      expect(sent[sent.length - 1]).not.toContain('127.0.0.1');
      const shown = await get(`/api/tasks/${task.id}`);
      expect(shown.status).toBe(200);
      expect(shown.body.state).toBe('idle');
      bridge = new FakeBridge();
      await bridge.start(); // so afterEach can stop something
    });
  });

  it('never sent a token or secret in any response (must stay the last test)', () => {
    // Runs after the others: every response, error and SSE text collected above.
    expect(sent.length).toBeGreaterThan(0);
    const all = sent.join('\n');
    expect(secrets.size).toBeGreaterThanOrEqual(4);
    for (const secret of secrets) expect(all).not.toContain(secret);
  });
});
