import { INestApplication } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { FakeBridge } from '../helpers/fake-bridge';
import { FakeLauncher } from '../helpers/fake-launcher';
import { createApp } from './create-app';

describe('task apps REST API (e2e)', () => {
  let app: INestApplication;
  let bridge: FakeBridge;
  let launcher: FakeLauncher;
  let dataDir: string;
  const sent: string[] = [];

  const api = () => request(app.getHttpServer());
  const call = async (method: 'get' | 'post', path: string) => {
    const res = await api()[method](path);
    sent.push(JSON.stringify(res.headers) + res.text);
    return res;
  };
  const startTask = async (): Promise<string> => {
    const res = await api().post('/api/tasks').send({ prompt: 'run the app' });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  beforeEach(async () => {
    bridge = new FakeBridge();
    bridge.apps = [
      { name: 'web', state: 'running', ports: [3000], url: '/ui', since: '2026-10-20T10:00:00Z' },
      { name: 'worker', state: 'stopped', ports: [], url: '/', since: '2026-10-20T10:00:00Z', exit_code: 1 },
    ];
    bridge.appLogLines = ['one', 'two', 'three'];
    await bridge.start();
    launcher = new FakeLauncher(bridge.url);
    launcher.appPorts = { web: { '3000': 49153 } };
    ({ app, dataDir } = await createApp({ launcher }));
  });
  afterEach(async () => {
    await app.close();
    await bridge.stop();
  });

  it('lists the apps with the host link of the first port, null without one', async () => {
    const id = await startTask();
    const res = await call('get', `/api/tasks/${id}/apps`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { ...bridge.apps[0], link: 'http://localhost:49153/ui' },
      { ...bridge.apps[1], link: null },
    ]);
  });

  it('lists apps without links for a task whose record has no ports', async () => {
    launcher.appPorts = undefined;
    const id = await startTask();
    const res = await call('get', `/api/tasks/${id}/apps`);
    expect(res.body.map((a: { link: unknown }) => a.link)).toEqual([null, null]);
  });

  it('relays start, stop and restart with 202 and the app', async () => {
    const id = await startTask();
    const stopped = await call('post', `/api/tasks/${id}/apps/web/stop`);
    expect(stopped.status).toBe(202);
    expect(stopped.body).toMatchObject({ name: 'web', state: 'stopped', link: 'http://localhost:49153/ui' });
    const started = await call('post', `/api/tasks/${id}/apps/web/start`);
    expect(started.status).toBe(202);
    expect(started.body.state).toBe('running');
    const restarted = await call('post', `/api/tasks/${id}/apps/web/restart`);
    expect(restarted.status).toBe(202);
    expect(bridge.requests.map((r) => `${r.method} ${r.url}`)).toEqual(expect.arrayContaining([
      'POST /apps/web/stop', 'POST /apps/web/start', 'POST /apps/web/restart',
    ]));
  });

  it('returns the last log lines, 200 by default', async () => {
    const id = await startTask();
    expect((await call('get', `/api/tasks/${id}/apps/web/logs?lines=2`)).body).toEqual({ lines: ['two', 'three'] });
    expect((await call('get', `/api/tasks/${id}/apps/web/logs`)).body).toEqual({ lines: ['one', 'two', 'three'] });
    expect(bridge.requests[bridge.requests.length - 1].url).toBe('/apps/web/logs?lines=200');
  });

  it.each(['0', '2001', 'x', '1.5', '-1', ''])('rejects logs lines=%s with 400 without asking the bridge', async (lines) => {
    const id = await startTask();
    const before = bridge.requests.length;
    expect((await call('get', `/api/tasks/${id}/apps/web/logs?lines=${lines}`)).status).toBe(400);
    expect(bridge.requests).toHaveLength(before);
  });

  it('accepts the limits 1 and 2000', async () => {
    const id = await startTask();
    expect((await call('get', `/api/tasks/${id}/apps/web/logs?lines=1`)).status).toBe(200);
    expect((await call('get', `/api/tasks/${id}/apps/web/logs?lines=2000`)).status).toBe(200);
  });

  it.each(['Web', '1web', 'we_b', 'we.b', 'a'.repeat(32), '..%2Fstatus', 'web%20x'])('rejects the app name %s with 400 without asking the bridge', async (name) => {
    const id = await startTask();
    const before = bridge.requests.length;
    expect((await call('post', `/api/tasks/${id}/apps/${name}/start`)).status).toBe(400);
    expect((await call('get', `/api/tasks/${id}/apps/${name}/logs`)).status).toBe(400);
    expect(bridge.requests).toHaveLength(before);
  });

  it('passes bridge 404 and 409 through', async () => {
    const id = await startTask();
    const missing = await call('post', `/api/tasks/${id}/apps/nope/start`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toMatch(/No app nope/);
    const running = await call('post', `/api/tasks/${id}/apps/web/start`);
    expect(running.status).toBe(409);
    expect(running.body.message).toBe('App is already running');
  });

  it('is 404 for an unknown task', async () => {
    expect((await call('get', '/api/tasks/T-20260101-zzzz/apps')).status).toBe(404);
  });

  it('is 409 for a task stopped via /stop', async () => {
    const id = await startTask();
    expect((await call('post', `/api/tasks/${id}/stop`)).status).toBe(202);
    for (const res of [
      await call('get', `/api/tasks/${id}/apps`),
      await call('post', `/api/tasks/${id}/apps/web/start`),
      await call('get', `/api/tasks/${id}/apps/web/logs`),
    ]) expect(res.status).toBe(409);
  });

  it('is 409 for a task whose container is not running', async () => {
    const id = await startTask();
    launcher.containers.get(id)!.running = false;
    expect((await call('get', `/api/tasks/${id}/apps`)).status).toBe(409);
  });

  it('never shows a task token', async () => {
    const id = await startTask();
    await call('get', `/api/tasks/${id}/apps`);
    await call('post', `/api/tasks/${id}/apps/web/restart`);
    await call('get', `/api/tasks/${id}/apps/web/logs`);
    await call('post', `/api/tasks/${id}/apps/nope/start`);
    const all = sent.join('\n');
    const files = readdirSync(dataDir).filter((n) => n.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const rec = JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as { taskToken: string; agentToken: string };
      expect(all).not.toContain(rec.taskToken);
      expect(all).not.toContain(rec.agentToken);
    }
  });
});

describe('task apps under the local launcher (e2e)', () => {
  it('answers 409 "Apps need the Docker launcher"', async () => {
    const bridge = new FakeBridge();
    await bridge.start();
    const { app } = await createApp({ launcher: new FakeLauncher(bridge.url), env: { ENGINE_LAUNCHER: 'local' } });
    try {
      const created = await request(app.getHttpServer()).post('/api/tasks').send({ prompt: 'p' });
      expect(created.status).toBe(201);
      const res = await request(app.getHttpServer()).get(`/api/tasks/${created.body.id as string}/apps`);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Apps need the Docker launcher');
    } finally {
      await app.close();
      await bridge.stop();
    }
  });
});
