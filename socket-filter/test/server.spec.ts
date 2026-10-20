import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect, Socket } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilterConfig } from '../src/config';
import { DEFAULT_LIMITS, FilterServer, isClientGone, startFilterServer } from '../src/server';
import { call, raw } from './helpers/client';
import { FakeUpstream } from './helpers/fake-upstream';

const ID = 'T-20261020-327f';
const NAME = `agentic-ui-task-${ID}`;
const LABELS = { 'agentic-ui.task': ID, 'agentic-ui.kind': 'task' };
const SECRET = 'secret-token-value-123';

function createBody(patch: Record<string, unknown> = {}, host: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Image: 'agentic-test:local',
    name: NAME,
    Cmd: ['agentic-bridge'],
    Labels: LABELS,
    Env: [`AGENTIC_TASK_TOKEN=${SECRET}`],
    HostConfig: { Binds: [`${NAME}:/task`], NetworkMode: 'agentic-net', CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], ...host },
    ...patch,
  };
}

describe('filter server', () => {
  let upstream: FakeUpstream;
  let filter: FilterServer;
  let dir: string;
  let sock: string;
  let logs: string[];
  let config: FilterConfig;

  beforeEach(async () => {
    upstream = await new FakeUpstream().start();
    dir = mkdtempSync(join(tmpdir(), 'filter-'));
    sock = join(dir, 'docker.sock');
    logs = [];
    config = {
      image: 'agentic-test:local',
      network: 'agentic-net',
      listen: sock,
      upstream: upstream.socketPath,
      namePrefix: 'agentic-ui-task-',
      labelPrefix: 'agentic-ui.',
      kindLabel: { key: 'agentic-ui.kind', value: 'task' },
      debug: false,
    };
    filter = await startFilterServer(config, (line) => logs.push(line));
  });

  afterEach(async () => {
    await filter.close();
    await upstream.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  function expectRefused(reply: { status: number; body: Buffer }, reason?: RegExp): void {
    expect(reply.status).toBe(403);
    const message = JSON.parse(reply.body.toString()).message as string;
    expect(message).toMatch(/^docker-filter: /);
    if (reason) expect(message).toMatch(reason);
  }

  describe('socket', () => {
    it('listens on a Unix socket with mode 0660', () => {
      const stat = lstatSync(sock);
      expect(stat.isSocket()).toBe(true);
      expect(stat.mode & 0o777).toBe(0o660);
    });

    it('replaces a stale socket file', async () => {
      await filter.close();
      // A process killed while listening leaves its socket file behind.
      spawnSync(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(sock)}, () => process.kill(process.pid, 'SIGKILL'))`]);
      expect(lstatSync(sock).isSocket()).toBe(true);
      chmodSync(sock, 0o777);
      filter = await startFilterServer(config, (line) => logs.push(line));
      expect(lstatSync(sock).mode & 0o777).toBe(0o660);
      expect((await call(sock, 'GET', '/_ping')).status).toBe(200);
    });

    it('refuses to start when the listen path is not a socket', async () => {
      await filter.close();
      writeFileSync(sock, 'x');
      await expect(startFilterServer(config, () => undefined)).rejects.toThrow(/FILTER_LISTEN/);
      filter = { close: async () => undefined } as FilterServer;
    });
  });

  describe('allowed requests', () => {
    it('forwards /_ping and passes the response through', async () => {
      const reply = await call(sock, 'GET', '/_ping');
      expect(reply.status).toBe(200);
      expect(reply.body.toString()).toBe('OK');
      expect(reply.headers['api-version']).toBe('1.47');
      expect(upstream.paths()).toEqual(['GET /_ping']);
      expect(logs).toEqual([]);
    });

    it('forwards HEAD /_ping', async () => {
      const reply = await call(sock, 'HEAD', '/_ping');
      expect(reply.status).toBe(200);
      expect(upstream.paths()).toEqual(['HEAD /_ping']);
    });

    it('does not pass client headers upstream', async () => {
      await call(sock, 'GET', '/version', { headers: { 'x-registry-auth': 'abc', 'x-forwarded-for': '1.2.3.4', cookie: 'a=b' } });
      const headers = upstream.requests[0].headers;
      expect(headers['x-registry-auth']).toBeUndefined();
      expect(headers['x-forwarded-for']).toBeUndefined();
      expect(headers.cookie).toBeUndefined();
    });

    it('forwards a valid container create with the validated body and only the name in the query', async () => {
      const body = Buffer.from(JSON.stringify(createBody()));
      const reply = await call(sock, 'POST', `/containers/create?name=${NAME}&Image=agentic-test%3Alocal&Env=AGENTIC_TASK_TOKEN%3D${SECRET}`, {
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(reply.status).toBe(201);
      expect(upstream.requests).toHaveLength(1);
      expect(upstream.requests[0].url).toBe(`/containers/create?name=${NAME}`);
      expect(upstream.requests[0].body.equals(body)).toBe(true);
      expect(upstream.requests[0].headers['content-type']).toBe('application/json');
      expect(upstream.requests[0].headers['content-length']).toBe(String(body.length));
    });

    it('forwards a create body sent with chunked encoding', async () => {
      const body = JSON.stringify(createBody());
      const reply = await new Promise<number>((resolve, reject) => {
        const req = request({ socketPath: sock, method: 'POST', path: `/containers/create?name=${NAME}`, headers: { 'content-type': 'application/json' } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.write(body.slice(0, 50));
        req.end(body.slice(50));
      });
      expect(reply).toBe(201);
      expect(upstream.requests[0].body.toString()).toBe(body);
    });

    it('adds the kind label to a container list', async () => {
      await call(sock, 'GET', '/containers/json?all=1');
      const url = new URL(upstream.requests[0].url, 'http://x');
      expect(JSON.parse(url.searchParams.get('filters') ?? '')).toEqual({ label: ['agentic-ui.kind=task'] });
    });

    it('inspects first, then forwards an action on a labelled container', async () => {
      upstream.addContainer(NAME, { labels: LABELS });
      const reply = await call(sock, 'POST', `/containers/${NAME}/start`);
      expect(reply.status).toBe(204);
      expect(upstream.paths()).toEqual([`GET /containers/${NAME}/json`, `POST /containers/${NAME}/start`]);
      expect(upstream.containers.get(NAME)?.running).toBe(true);
    });

    it('keeps the version prefix for the inspect and the action', async () => {
      upstream.addContainer(NAME, { labels: LABELS, running: true });
      const reply = await call(sock, 'POST', `/v1.44/containers/${NAME}/stop?t=10`);
      expect(reply.status).toBe(204);
      expect(upstream.paths()).toEqual([`GET /v1.44/containers/${NAME}/json`, `POST /v1.44/containers/${NAME}/stop?t=10`]);
    });

    it('passes the 404 of a missing container through and forwards nothing else', async () => {
      const reply = await call(sock, 'DELETE', `/containers/${NAME}?force=true&v=true`);
      expect(reply.status).toBe(404);
      expect(JSON.parse(reply.body.toString()).message).toMatch(/No such container/);
      expect(upstream.paths()).toEqual([`GET /containers/${NAME}/json`]);
    });

    it('removes a labelled volume after inspecting it', async () => {
      upstream.volumes.set(NAME, { Name: NAME, Labels: LABELS });
      const reply = await call(sock, 'DELETE', `/volumes/${NAME}`);
      expect(reply.status).toBe(204);
      expect(upstream.paths()).toEqual([`GET /volumes/${NAME}`, `DELETE /volumes/${NAME}`]);
    });

    it('streams an archive byte for byte', async () => {
      const payload = randomBytes(3 * 1024 * 1024 + 123);
      upstream.addContainer(NAME, { labels: LABELS });
      upstream.override = (req, res) => {
        if (!req.url.includes('/archive')) return false;
        res.writeHead(200, { 'content-type': 'application/x-tar' });
        upstream.stream(res, payload);
        return true;
      };
      const reply = await call(sock, 'GET', `/containers/${NAME}/archive?path=%2Ftask%2Fledger.jsonl`);
      expect(reply.status).toBe(200);
      expect(reply.headers['content-type']).toBe('application/x-tar');
      expect(createHash('sha256').update(reply.body).digest('hex')).toBe(createHash('sha256').update(payload).digest('hex'));
      expect(upstream.requests[1].url).toBe(`/containers/${NAME}/archive?path=%2Ftask%2Fledger.jsonl`);
    });

    it('starts streaming before the upstream response is complete', async () => {
      upstream.addContainer(NAME, { labels: LABELS });
      let finish: () => void = () => undefined;
      upstream.override = (req, res) => {
        if (!req.url.includes('/archive')) return false;
        res.writeHead(200, { 'content-type': 'application/x-tar' });
        res.write(Buffer.alloc(1000, 1));
        finish = () => res.end(Buffer.alloc(10, 2));
        return true;
      };
      const first = await new Promise<Buffer>((resolve, reject) => {
        const req = request({ socketPath: sock, method: 'GET', path: `/containers/${NAME}/archive?path=%2Ftask%2Fx` }, (res) => {
          res.once('data', (c: Buffer) => {
            resolve(c);
            finish();
            res.resume();
          });
        });
        req.on('error', reject);
        req.end();
      });
      expect(first.length).toBeGreaterThan(0);
    });

    it('passes HEAD archive stat headers through', async () => {
      upstream.addContainer(NAME, { labels: LABELS, files: { '/work/.worktrees/a': Buffer.from('x') } });
      const reply = await call(sock, 'HEAD', `/containers/${NAME}/archive?path=%2Fwork%2F.worktrees%2Fa`);
      expect(reply.status).toBe(200);
      expect(reply.headers['x-docker-container-path-stat']).toBeDefined();
    });

    it('logs allowed requests only with FILTER_DEBUG', async () => {
      await filter.close();
      filter = await startFilterServer({ ...config, debug: true }, (line) => logs.push(line));
      await call(sock, 'GET', '/_ping');
      expect(logs).toEqual(['docker-filter: allowed GET /_ping']);
    });
  });

  describe('refused requests', () => {
    it('answers 403 JSON, logs one line and sends nothing upstream', async () => {
      const reply = await call(sock, 'POST', `/containers/${NAME}/exec`, { headers: { 'content-type': 'application/json' }, body: '{"Cmd":["sh"]}' });
      expectRefused(reply, /endpoint not allowed/);
      expect(reply.headers['content-type']).toMatch(/application\/json/);
      expect(upstream.requests).toEqual([]);
      expect(logs).toEqual([`docker-filter: refused POST /containers/${NAME}/exec: endpoint not allowed`]);
    });

    it('never logs Env or the query', async () => {
      const body = JSON.stringify(createBody({}, { Privileged: true }));
      const reply = await call(sock, 'POST', `/containers/create?name=${NAME}&Env=AGENTIC_TASK_TOKEN%3D${SECRET}`, { body });
      expectRefused(reply, /Privileged/);
      expect(logs).toHaveLength(1);
      expect(logs[0]).not.toContain(SECRET);
      expect(logs[0]).not.toContain('?');
      expect(reply.body.toString()).not.toContain(SECRET);
      expect(upstream.requests).toEqual([]);
    });

    it.each([
      ['a host-path bind', createBody({}, { Binds: ['/:/host'] })],
      ['another image', createBody({ Image: 'alpine' })],
      ['bad JSON', '{"Image":'],
    ])('refuses a container create with %s', async (_label, body) => {
      const reply = await call(sock, 'POST', `/containers/create?name=${NAME}`, { body: typeof body === 'string' ? body : JSON.stringify(body) });
      expectRefused(reply);
      expect(upstream.requests).toEqual([]);
    });

    it.each([
      ['start', 'POST', `/containers/${NAME}/start`],
      ['stop', 'POST', `/containers/${NAME}/stop?t=10`],
      ['remove', 'DELETE', `/containers/${NAME}?force=true&v=true`],
      ['inspect', 'GET', `/containers/${NAME}/json`],
      ['archive', 'GET', `/containers/${NAME}/archive?path=%2Ftask%2Fledger.jsonl`],
    ])('refuses %s of a container whose inspect lacks the kind label', async (_label, method, path) => {
      upstream.addContainer(NAME, { labels: { 'agentic-ui.task': ID }, running: true });
      const reply = await call(sock, method, path);
      expectRefused(reply, /kind label/);
      expect(upstream.paths()).toEqual([`GET /containers/${NAME}/json`]);
      expect(logs).toHaveLength(1);
    });

    it('refuses when the inspect answers for a container with another name', async () => {
      upstream.override = (req, res) => {
        if (!req.url.endsWith('/json')) return false;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ Name: '/someone-else', Config: { Labels: LABELS } }));
        return true;
      };
      expectRefused(await call(sock, 'POST', `/containers/${NAME}/start`));
      expect(upstream.requests).toHaveLength(1);
    });

    it('refuses when the inspect answer is not JSON', async () => {
      upstream.override = (req, res) => {
        res.writeHead(200);
        res.end('nope');
        return true;
      };
      expectRefused(await call(sock, 'POST', `/containers/${NAME}/start`));
      expect(upstream.requests).toHaveLength(1);
    });

    it('refuses removing a volume without the kind label', async () => {
      upstream.volumes.set(NAME, { Name: NAME, Labels: {} });
      expectRefused(await call(sock, 'DELETE', `/volumes/${NAME}`), /kind label/);
      expect(upstream.paths()).toEqual([`GET /volumes/${NAME}`]);
      expect(upstream.volumes.has(NAME)).toBe(true);
    });

    it('refuses an upgrade (hijack) request without reaching upstream', async () => {
      upstream.addContainer(NAME, { labels: LABELS });
      const response = await raw(sock, `POST /containers/${NAME}/attach?stream=1 HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: 0\r\n\r\n`);
      expect(response).toMatch(/^HTTP\/1\.1 403/);
      expect(response).not.toMatch(/101/);
      expect(upstream.requests).toEqual([]);
      expect(logs).toHaveLength(1);
    });

    it('refuses an upgrade on an allowed endpoint', async () => {
      const response = await raw(sock, 'GET /_ping HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: h2c\r\n\r\n');
      expect(response).toMatch(/^HTTP\/1\.1 403/);
      expect(upstream.requests).toEqual([]);
    });

    it('refuses CONNECT', async () => {
      const response = await raw(sock, 'CONNECT docker:2375 HTTP/1.1\r\nHost: docker:2375\r\n\r\n');
      expect(response).toMatch(/^HTTP\/1\.1 (403|400)/);
      expect(upstream.requests).toEqual([]);
    });

    it('refuses an absolute-URI request target', async () => {
      const response = await raw(sock, `POST http://docker/containers/${NAME}/exec HTTP/1.1\r\nHost: docker\r\nContent-Length: 0\r\n\r\n`);
      expect(response).toMatch(/^HTTP\/1\.1 403/);
      expect(upstream.requests).toEqual([]);
    });

    it('refuses a body over 1 MB announced by Content-Length without reading it', async () => {
      const response = await raw(sock, `POST /containers/create?name=${NAME} HTTP/1.1\r\nHost: docker\r\nContent-Length: ${2 * 1024 * 1024}\r\n\r\n{`);
      expect(response).toMatch(/^HTTP\/1\.1 403/);
      expect(response).toMatch(/too large/);
      expect(upstream.requests).toEqual([]);
    });

    it('refuses a chunked body that grows over 1 MB', async () => {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ socketPath: sock, method: 'POST', path: `/containers/create?name=${NAME}` }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        const chunk = Buffer.alloc(64 * 1024, 0x20);
        let sent = 0;
        const pump = (): void => {
          if (sent > 2 * 1024 * 1024) return void req.end();
          sent += chunk.length;
          if (req.write(chunk)) setImmediate(pump);
          else req.once('drain', pump);
        };
        pump();
      }).catch(() => 403);
      expect(status).toBe(403);
      expect(upstream.requests).toEqual([]);
    });

    it.each([
      ['Content-Length and Transfer-Encoding', `POST /_ping HTTP/1.1\r\nHost: d\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`],
      ['two Content-Length headers', `POST /_ping HTTP/1.1\r\nHost: d\r\nContent-Length: 0\r\nContent-Length: 5\r\n\r\n`],
      ['a bad Transfer-Encoding', `POST /_ping HTTP/1.1\r\nHost: d\r\nTransfer-Encoding: xchunked\r\n\r\n`],
      ['a space before the colon', `GET /_ping HTTP/1.1\r\nHost: d\r\nTransfer-Encoding : chunked\r\n\r\n`],
    ])('refuses ambiguous framing: %s', async (_label, text) => {
      const response = await raw(sock, text);
      expect(response).toMatch(/^HTTP\/1\.1 (400|403)/);
      expect(upstream.requests).toEqual([]);
    });

    it('checks every pipelined request on its own (no smuggling behind an allowed one)', async () => {
      const exec = `POST /containers/${NAME}/exec HTTP/1.1\r\nHost: d\r\nContent-Length: 2\r\n\r\n{}`;
      const response = await raw(sock, `POST /_ping HTTP/1.1\r\nHost: d\r\nTransfer-Encoding: chunked\r\n\r\n${(exec.length).toString(16)}\r\n${exec}\r\n0\r\n\r\n` + exec);
      // The first request has a body (refused: no body on _ping); the second is the exec itself (refused).
      expect(response.match(/HTTP\/1\.1 403/g)?.length).toBe(2);
      expect(upstream.requests).toEqual([]);
    });

    it('refuses OPTIONS', async () => {
      expectRefused(await call(sock, 'OPTIONS', '/_ping'));
      expect(upstream.requests).toEqual([]);
    });

    it('answers a refused HEAD without a body', async () => {
      const reply = await call(sock, 'HEAD', '/info');
      expect(reply.status).toBe(403);
      expect(reply.body.length).toBe(0);
    });

    it('answers 502 when the upstream is down', async () => {
      await upstream.stop();
      const reply = await call(sock, 'GET', '/_ping');
      expect(reply.status).toBe(502);
      expect(JSON.parse(reply.body.toString()).message).toMatch(/^docker-filter: /);
      upstream = await new FakeUpstream().start();
    });
  });

  describe('client going away', () => {
    it('treats a reset, a closed pipe and a truncated request as the client leaving, parse errors as refusals', () => {
      for (const code of ['ECONNRESET', 'EPIPE', 'HPE_INVALID_EOF_STATE']) expect(isClientGone(code)).toBe(true);
      for (const code of [undefined, 'HPE_INVALID_METHOD', 'HPE_HEADER_OVERFLOW', 'ERR_HTTP_REQUEST_TIMEOUT']) expect(isClientGone(code)).toBe(false);
    });

    it('does not log a refusal when the client exits right after the status line', async () => {
      // The compose healthcheck's old pattern: exit as soon as the response head arrives, with the body unread.
      const script = `require('http').get({socketPath:process.argv[1],path:'/_ping'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))`;
      for (let i = 0; i < 5; i++) await new Promise((resolve) => spawn(process.execPath, ['-e', script, sock]).on('close', resolve));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(logs).toEqual([]);
    });

    it('does not log a refusal when the client drops the connection mid-request', async () => {
      const client = connect(sock);
      await new Promise<void>((resolve) => client.once('connect', resolve));
      client.write('POST /containers/create HTTP/1.1\r\nHost: docker\r\nContent-Length: 100\r\n\r\n{');
      client.destroy();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(logs).toEqual([]);
      expect(upstream.requests).toEqual([]);
    });

    it('still logs and answers a real parse error', async () => {
      const reply = await raw(sock, 'GARBAGE\r\n\r\n');
      expect(reply).toMatch(/^HTTP\/1\.1 400/);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('refused a malformed request');
    });
  });

  describe('limits', () => {
    let limited: FilterServer;
    let limitedSock: string;

    afterEach(async () => {
      await limited?.close();
    });

    const startLimited = async (limits: { maxConnections?: number; requestTimeoutMs?: number }) => {
      limitedSock = join(dir, 'limited.sock');
      limited = await startFilterServer({ ...config, listen: limitedSock }, (line) => logs.push(line), limits);
    };

    it('has defaults of 64 connections and a 30 s request timeout', () => {
      expect(DEFAULT_LIMITS).toEqual({ maxConnections: 64, requestTimeoutMs: 30000 });
    });

    it('drops connections beyond the maximum and serves again once one is closed', async () => {
      await startLimited({ maxConnections: 2 });
      const open = () =>
        new Promise<Socket>((resolve) => {
          const s = connect(limitedSock);
          s.on('error', () => undefined);
          s.on('connect', () => resolve(s));
        });
      const a = await open();
      const b = await open();
      const closedC = await new Promise<boolean>((resolve) => {
        const c = connect(limitedSock);
        const timer = setTimeout(() => {
          c.destroy();
          resolve(false);
        }, 1000);
        c.on('error', () => undefined);
        c.on('close', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      expect(closedC).toBe(true);
      a.destroy();
      await new Promise((r) => setTimeout(r, 100));
      expect((await call(limitedSock, 'GET', '/_ping')).status).toBe(200);
      b.destroy();
    });

    it('closes a connection that does not finish its request in time, but not a streamed response', async () => {
      await startLimited({ requestTimeoutMs: 300 });
      const answer = await raw(limitedSock, 'POST /containers/x HTTP/1.1\r\nHost: d\r\nContent-Length: 10\r\n\r\nab', 1500);
      expect(answer).toMatch(/^HTTP\/1.1 (400|408)/);

      upstream.addContainer(NAME, { labels: LABELS });
      upstream.override = (req, res) => {
        if (!req.url.includes('/archive')) return false;
        res.writeHead(200, { 'content-type': 'application/x-tar' });
        let n = 0;
        const timer = setInterval(() => {
          res.write(Buffer.alloc(10, 1));
          if (++n === 15) {
            clearInterval(timer);
            res.end();
          }
        }, 60);
        return true;
      };
      const reply = await call(limitedSock, 'GET', `/containers/${NAME}/archive?path=%2Ftask%2Fa`);
      expect(reply.status).toBe(200);
      expect(reply.body.length).toBe(150);
    });
  });
});
