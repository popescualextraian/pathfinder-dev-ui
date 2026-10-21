import { INestApplication } from '@nestjs/common';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { FakeBridge } from '../helpers/fake-bridge';
import { FakeLauncher } from '../helpers/fake-launcher';
import { FAKE_GH_TOKEN, FAKE_OAUTH_TOKEN } from '../helpers/test-env';
import { createApp } from './create-app';

jest.setTimeout(20_000);

const body = (extra: object = {}) => ({
  title: 'Nightly deps', prompt: 'Update the dependencies and push a branch', repository: 'default', when: { cron: '0 2 * * 1-5' }, ...extra,
});

// The schedule API with the real scheduler and engine on a fake launcher and bridge. The tick is an hour long: runs come
// from "Run now", and the end of a run is made by hand (bridge gone, state.json and result.md set on the launcher).
describe('schedules API (e2e)', () => {
  let app: INestApplication;
  let bridge: FakeBridge;
  let launcher: FakeLauncher;
  let dataDir: string;
  const sent: string[] = [];
  const api = () => request(app.getHttpServer());
  const record = <T extends request.Response>(res: T): T => {
    sent.push(JSON.stringify(res.headers) + res.text);
    return res;
  };
  const create = async (extra: object = {}) => record(await api().post('/api/schedules').send(body(extra)).expect(201)).body;
  const until = async <T>(read: () => Promise<T | undefined>): Promise<T> => {
    for (let i = 0; i < 100; i++) {
      const value = await read();
      if (value !== undefined) return value;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('timed out');
  };

  beforeEach(async () => {
    bridge = new FakeBridge();
    await bridge.start();
    launcher = new FakeLauncher(bridge.url);
    ({ app, dataDir } = await createApp({ launcher, maxRunning: 1, env: { ENGINE_POLL_SECONDS: '1' } }));
  });
  afterEach(async () => {
    await app.close();
    await bridge.stop();
  });

  it('creates with an id from the title and a computed next run, and keeps a file of mode 600', async () => {
    const created = await create();
    expect(created).toMatchObject({
      id: 'nightly-deps', title: 'Nightly deps', repository: 'default', when: { cron: '0 2 * * 1-5' }, timeoutMinutes: 120, enabled: true,
      nextRunAt: expect.stringMatching(/T02:00:00/), results: [],
    });
    expect(await create()).toMatchObject({ id: 'nightly-deps-2' });
    expect((await create({ title: 'New' })).id).toBe('new-2');
    const file = join(dataDir, 'schedules', 'nightly-deps.json');
    expect(readdirSync(join(dataDir, 'schedules'))).toContain('nightly-deps.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('answers 400 with the field for invalid input', async () => {
    const cases: Array<[object, string]> = [
      [{ title: '' }, 'title'],
      [{ prompt: '' }, 'prompt'],
      [{ repository: 'nope' }, 'repository'],
      [{ when: { cron: 'not cron' } }, 'when.cron'],
      [{ when: { at: '2001-01-01T10:00' } }, 'when.at'],
      [{ timeoutMinutes: 0 }, 'timeoutMinutes'],
      [{ timeoutMinutes: 1441 }, 'timeoutMinutes'],
    ];
    for (const [extra, field] of cases) {
      const res = record(await api().post('/api/schedules').send(body(extra)).expect(400));
      expect(res.body).toMatchObject({ statusCode: 400, field, message: expect.any(String), path: '/api/schedules' });
    }
    await api().post('/api/schedules').send({}).expect(400);
    await api().post('/api/schedules').send('x').expect(400);
    expect((await api().get('/api/schedules').expect(200)).body).toEqual([]);
  });

  it('lists without results but with the last one, gets one with its results, 404 for unknown', async () => {
    await create();
    expect((await api().get('/api/schedules').expect(200)).body).toEqual([expect.not.objectContaining({ results: expect.anything() })]);
    await api().post('/api/schedules/nightly-deps/run').expect(202);
    const list = record(await api().get('/api/schedules').expect(200)).body;
    expect(list[0].lastResult).toMatchObject({ outcome: 'running', trigger: 'manual', taskId: expect.any(String) });
    expect(list[0].results).toBeUndefined();
    const one = record(await api().get('/api/schedules/nightly-deps').expect(200)).body;
    expect(one.results).toHaveLength(1);
    await api().get('/api/schedules/nope').expect(404);
    await api().put('/api/schedules/nope').send(body()).expect(404);
    await api().delete('/api/schedules/nope').expect(404);
    await api().post('/api/schedules/nope/run').expect(404);
  });

  it('carries the zone on the list, one schedule, create and replace', async () => {
    expect((await create()).zone).toBe('UTC');
    expect((await api().get('/api/schedules').expect(200)).body[0].zone).toBe('UTC');
    expect((await api().get('/api/schedules/nightly-deps').expect(200)).body.zone).toBe('UTC');
    expect((await api().put('/api/schedules/nightly-deps').send(body()).expect(200)).body.zone).toBe('UTC');
    const file = JSON.parse(readFileSync(join(dataDir, 'schedules', 'nightly-deps.json'), 'utf8'));
    expect(file.zone).toBeUndefined();
  });

  it('replaces (keeps id and results, recomputes next run) and toggles enabled', async () => {
    const created = await create();
    await api().post('/api/schedules/nightly-deps/run').expect(202);
    const replaced = record(await api().put('/api/schedules/nightly-deps').send(body({ title: 'Renamed', when: { cron: '30 4 * * *' }, enabled: false })).expect(200)).body;
    expect(replaced).toMatchObject({ id: 'nightly-deps', title: 'Renamed', createdAt: created.createdAt, enabled: false, nextRunAt: null });
    expect(replaced.results).toHaveLength(1);
    const enabled = (await api().put('/api/schedules/nightly-deps').send(body({ when: { cron: '30 4 * * *' }, enabled: true })).expect(200)).body;
    expect(enabled).toMatchObject({ enabled: true, nextRunAt: expect.stringMatching(/T04:30:00/) });
    const bad = await api().put('/api/schedules/nightly-deps').send(body({ repository: 'nope' })).expect(400);
    expect(bad.body.field).toBe('repository');
  });

  it('runs now: 202, a task started with the scheduled options, the result done with the summary at its end', async () => {
    await create({ timeoutMinutes: 30, enabled: false });
    bridge.state = 'running'; // the agent is working on its prompt
    const res = record(await api().post('/api/schedules/nightly-deps/run').expect(202));
    expect(res.body).toMatchObject({ trigger: 'manual', outcome: 'running', taskId: expect.stringMatching(/^T-/), firedAt: expect.any(String) });
    const taskId = res.body.taskId as string;
    expect(launcher.specs.at(-1)!.scheduled).toEqual({ runTimeoutSeconds: 1800 });
    const task = record(await api().get(`/api/tasks/${taskId}`).expect(200)).body;
    expect(task).toMatchObject({ scheduleId: 'nightly-deps', scheduleTitle: 'Nightly deps' });
    // Run now leaves the schedule as it was.
    expect((await api().get('/api/schedules/nightly-deps').expect(200)).body).toMatchObject({ enabled: false, nextRunAt: null });

    // The run ends: the bridge exits after its summary, the container is gone, state.json and result.md are left.
    await bridge.stop();
    launcher.containers.get(taskId)!.running = false;
    launcher.setTaskFile(taskId, 'state.json', JSON.stringify({ state: 'stopped', reason: 'scheduled-done' }));
    launcher.setTaskFile(taskId, 'result.md', 'Updated 3 dependencies.\n\nPushed a branch.');
    const done = await until(async () => {
      const r = (await api().get('/api/schedules/nightly-deps').expect(200)).body.results[0];
      return r.outcome === 'running' ? undefined : r;
    });
    record(await api().get('/api/schedules/nightly-deps'));
    expect(done).toMatchObject({ outcome: 'done', taskId, summary: 'Updated 3 dependencies.\n\nPushed a branch.', endedAt: expect.any(String) });
    expect((await api().get(`/api/tasks/${taskId}`).expect(200)).body.summaryLine).toBe('Updated 3 dependencies.');
  });

  it('records a skipped result while the previous run still runs, and when the running cap is reached', async () => {
    await create();
    await create({ title: 'Other' });
    const first = (await api().post('/api/schedules/nightly-deps/run').expect(202)).body;
    expect(first.outcome).toBe('running');
    const again = record(await api().post('/api/schedules/nightly-deps/run').expect(202)).body;
    expect(again).toMatchObject({ outcome: 'skipped', reason: 'the previous run still runs', trigger: 'manual' });
    expect(again.taskId).toBeUndefined();
    // maxRunning is 1 and that run holds it.
    const capped = (await api().post('/api/schedules/other/run').expect(202)).body;
    expect(capped).toMatchObject({ outcome: 'skipped', reason: 'the running cap is reached' });
    const results = (await api().get('/api/schedules/nightly-deps').expect(200)).body.results;
    expect(results.map((r: { outcome: string }) => r.outcome)).toEqual(['skipped', 'running']);
  });

  it('deletes the schedule and its results (204), the task stays', async () => {
    await create();
    const { taskId } = (await api().post('/api/schedules/nightly-deps/run').expect(202)).body;
    await api().delete('/api/schedules/nightly-deps').expect(204);
    await api().get('/api/schedules/nightly-deps').expect(404);
    expect((await api().get('/api/schedules').expect(200)).body).toEqual([]);
    await api().get(`/api/tasks/${taskId}`).expect(200);
  });

  it('previews the next three times in the zone, or the field error (also for a path like /preview, not an id)', async () => {
    const ok = record(await api().post('/api/schedules/preview').send({ when: { cron: '0 2 * * *' } }).expect(200)).body;
    expect(ok.zone).toBe('UTC');
    expect(ok.next).toHaveLength(3);
    expect(ok.next[0]).toMatch(/T02:00:00/);
    const bad = await api().post('/api/schedules/preview').send({ when: { cron: 'x' } }).expect(400);
    expect(bad.body).toMatchObject({ field: 'when.cron' });
    expect((await api().post('/api/schedules/preview').send({}).expect(400)).body.field).toMatch(/^when/);
  });

  it('never shows a token or secret', async () => {
    await create();
    await api().post('/api/schedules/nightly-deps/run').expect(202);
    const text = sent.join('\n');
    for (const secret of [FAKE_GH_TOKEN, FAKE_OAUTH_TOKEN]) expect(text).not.toContain(secret);
    const rec = readdirSync(dataDir).filter((n) => n.startsWith('T-') && n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(dataDir, n), 'utf8')) as { taskToken: string });
    expect(rec.length).toBeGreaterThan(0);
    for (const r of rec) expect(text).not.toContain(r.taskToken);
  });
});
