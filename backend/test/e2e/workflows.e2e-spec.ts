import { INestApplication } from '@nestjs/common';
import { chmodSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { FakeBridge } from '../helpers/fake-bridge';
import { FakeGitlab } from '../helpers/fake-gitlab';
import { FakeLauncher } from '../helpers/fake-launcher';
import { openSse } from '../helpers/sse-client';
import { FAKE_GH_TOKEN, FAKE_OAUTH_TOKEN } from '../helpers/test-env';
import { createApp } from './create-app';

jest.setTimeout(20_000);

const TOKEN = 'glpat-made-up-workflow-token-0815';

const TWO_STEPS = `title: Do and finish
steps:
  - id: work
    title: Work
    stage: doing
    prompt: "Work on #{{item.id}}: {{item.title}}"
    gate: human
doneStage: done
`;

// Wiring of the workflow API with the real runner, engine (fake launcher and bridge) and backlog (fake GitLab).
// The full run flow is covered by its own e2e suite.
describe('workflows API (e2e)', () => {
  let gitlab: FakeGitlab;
  let bridge: FakeBridge;
  let app: INestApplication;
  let dataDir: string;
  let itemId: string;
  const sent: string[] = [];
  const api = () => request(app.getHttpServer());
  const record = <T extends request.Response>(res: T): T => {
    sent.push(res.text);
    return res;
  };

  beforeEach(async () => {
    gitlab = new FakeGitlab(TOKEN);
    await gitlab.start();
    itemId = String(gitlab.addIssue({ title: 'Fix it', labels: ['status::backlog'] }));
    bridge = new FakeBridge();
    await bridge.start();
    ({ app, dataDir } = await createApp({
      launcher: new FakeLauncher(bridge.url),
      backlog: { gitlab },
      workflows: { 'do-it.yaml': TWO_STEPS, 'bad.yaml': 'title: Bad\nsteps:\n  - id: x\n    title: X\n    stage: nowhere\n    gate: human\n    prompt: p\n' },
    }));
  });
  afterEach(async () => {
    await app.close();
    await bridge.stop();
    await gitlab.stop();
  });

  it('lists the definitions as a summary and the refused files', async () => {
    const res = record(await api().get('/api/workflows').expect(200));
    expect(res.body).toEqual({
      definitions: [{
        id: 'do-it', title: 'Do and finish', doneStage: 'done',
        steps: [{ id: 'work', title: 'Work', stage: 'doing', gate: 'human' }],
      }],
      refused: [{ file: 'bad.yaml', error: expect.stringContaining('bad.yaml'), version: expect.stringMatching(/^[0-9a-f]{64}$/) }],
      writable: true,
    });
  });

  describe('editing definitions', () => {
    const definition = {
      title: 'New one',
      steps: [{ id: 'a', title: 'A', gate: 'auto', prompt: 'Do {{item.title}}' }],
    };

    it('reads a definition with its version', async () => {
      const res = await api().get('/api/workflows/do-it').expect(200);
      expect(res.body).toEqual({
        definition: expect.objectContaining({ id: 'do-it', title: 'Do and finish', doneStage: 'done' }), version: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(res.body.definition.steps[0].prompt).toContain('{{item.title}}');
      await api().get('/api/workflows/nope').expect(404);
      await api().get('/api/workflows/bad').expect(404);
    });

    it('validates without writing: [] when fine, else the first error with its location', async () => {
      expect((await api().post('/api/workflows/validate').send({ definition }).expect(200)).body).toEqual({ errors: [] });
      const bad = { ...definition, steps: [{ ...definition.steps[0], stage: 'nowhere' }] };
      const res = await api().post('/api/workflows/validate').send({ definition: bad }).expect(200);
      expect(res.body.errors).toEqual([{ message: expect.stringContaining('nowhere'), stepId: 'a', field: 'stage' }]);
      await api().get('/api/workflows/new-one').expect(404);
      await api().post('/api/workflows/validate').send({ definition: { title: 5 } }).expect(400);
      await api().post('/api/workflows/validate').send({}).expect(400);
    });

    it('creates (409 when the id exists), updates with the version (409 when stale) and deletes', async () => {
      const created = await api().post('/api/workflows').send({ id: 'new-one', definition }).expect(201);
      expect(created.body).toEqual({ definition: { id: 'new-one', ...definition }, version: expect.any(String) });
      expect(readFileSync(join(dataDir, 'workflows', 'new-one.yaml'), 'utf8')).toContain('title: New one');
      await api().post('/api/workflows').send({ id: 'new-one', definition }).expect(409);
      await api().post('/api/workflows').send({ id: 'do-it', definition }).expect(409);

      const changed = { ...definition, title: 'Changed' };
      const updated = await api().put('/api/workflows/new-one').send({ definition: changed, version: created.body.version }).expect(200);
      expect(updated.body.definition.title).toBe('Changed');
      expect(updated.body.version).not.toBe(created.body.version);
      await api().put('/api/workflows/new-one').send({ definition, version: created.body.version }).expect(409);
      await api().put('/api/workflows/gone').send({ definition, version: 'x' }).expect(404);
      await api().put('/api/workflows/new-one').send({ definition }).expect(400);
      expect((await api().get('/api/workflows').expect(200)).body.definitions.map((d: { id: string }) => d.id)).toContain('new-one');

      await api().delete('/api/workflows/new-one').expect(400);
      await api().delete('/api/workflows/new-one?version=stale').expect(409);
      await api().delete(`/api/workflows/new-one?version=${updated.body.version}`).expect(204);
      await api().delete(`/api/workflows/new-one?version=${updated.body.version}`).expect(404);
    });

    it('answers a rule broken on create or update with 400 and the location', async () => {
      const bad = { ...definition, steps: [{ ...definition.steps[0], stage: 'nowhere' }] };
      const res = await api().post('/api/workflows').send({ id: 'x', definition: bad }).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, message: expect.stringContaining('nowhere'), location: { stepId: 'a', field: 'stage' } });
      await api().post('/api/workflows').send({ id: 'Bad Id', definition }).expect(400);
      expect(existsSync(join(dataDir, 'workflows', 'x.yaml'))).toBe(false);
    });

    it('deletes a refused file by name with its version, and nothing else by name', async () => {
      const list = (await api().get('/api/workflows').expect(200)).body;
      const { file, version } = list.refused[0];
      await api().delete(`/api/workflows/refused/${file}`).expect(400);
      await api().delete(`/api/workflows/refused/${file}?version=stale`).expect(409);
      await api().delete('/api/workflows/refused/do-it.yaml?version=x').expect(404);
      await api().delete(`/api/workflows/refused/${file}?version=${version}`).expect(204);
      expect(existsSync(join(dataDir, 'workflows', 'bad.yaml'))).toBe(false);
      expect(existsSync(join(dataDir, 'workflows', 'do-it.yaml'))).toBe(true);
    });

    it('answers 403 to every write when the folder is not writable', async () => {
      const dir = join(dataDir, 'workflows');
      chmodSync(dir, 0o555);
      try {
        if (process.getuid?.() === 0) return; // root ignores modes
        expect((await api().get('/api/workflows').expect(200)).body.writable).toBe(false);
        await api().post('/api/workflows').send({ id: 'x', definition }).expect(403);
        await api().put('/api/workflows/do-it').send({ definition, version: 'v' }).expect(403);
        await api().delete('/api/workflows/do-it?version=v').expect(403);
        await api().delete('/api/workflows/refused/bad.yaml?version=v').expect(403);
      } finally {
        chmodSync(dir, 0o755);
      }
    });
  });

  it('starts a run on an item: task created, card moved, run stored; a second start is 409', async () => {
    const stream = openSse(app, '/api/workflow-runs/stream');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const res = record(await api().post('/api/workflow-runs').send({ itemId, workflowId: 'do-it' }).expect(201));
    expect(res.body).toMatchObject({
      id: expect.stringMatching(/^R-\d{8}-[a-z0-9]{8}$/), workflowId: 'do-it', itemId, stepIndex: 0,
      taskId: expect.stringMatching(/^T-/), sessions: { main: { status: 'running' } },
    });
    expect(['running', 'needs-you']).toContain(res.body.state);
    const task = record(await api().get(`/api/tasks/${res.body.taskId}`).expect(200));
    expect(task.body.title).toBe(`#${itemId} Fix it`);
    expect(task.body.prompt).toBe(`Work on #${itemId}: Fix it`);
    expect(gitlab.issues.get(Number(itemId))?.labels).toContain('status::doing');
    await stream.next((e) => e.event === 'run' && e.data.id === res.body.id);
    stream.close();

    const files = readdirSync(join(dataDir, 'workflow-runs'));
    expect(files).toEqual([`${res.body.id}.json`]);
    expect(statSync(join(dataDir, 'workflow-runs', files[0])).mode & 0o777).toBe(0o600);

    record(await api().post('/api/workflow-runs').send({ itemId, workflowId: 'do-it' }).expect(409));
    const list = record(await api().get(`/api/workflow-runs?itemId=${itemId}`).expect(200));
    expect(list.body.map((r: { id: string }) => r.id)).toEqual([res.body.id]);
    record(await api().get(`/api/workflow-runs/${res.body.id}`).expect(200));
  });

  it('stops a run (409 the second time) and refuses to advance a run that is not waiting', async () => {
    const run = record(await api().post('/api/workflow-runs').send({ itemId, workflowId: 'do-it' }).expect(201)).body;
    const advance = record(await api().post(`/api/workflow-runs/${run.id}/advance`).send({}).expect(409));
    expect(advance.body.message).toEqual(expect.any(String));
    const stopped = record(await api().post(`/api/workflow-runs/${run.id}/stop`).expect(200));
    expect(stopped.body.state).toBe('stopped');
    record(await api().post(`/api/workflow-runs/${run.id}/stop`).expect(409));
  });

  it('answers 404 for unknown runs, workflows and items, and 400 for bad input', async () => {
    record(await api().get('/api/workflow-runs/R-20261020-unknown1').expect(404));
    record(await api().post('/api/workflow-runs/R-20261020-unknown1/stop').expect(404));
    record(await api().post('/api/workflow-runs').send({ itemId, workflowId: 'missing' }).expect(404));
    record(await api().post('/api/workflow-runs').send({ itemId: '99999', workflowId: 'do-it' }).expect(404));
    record(await api().post('/api/workflow-runs').send({ itemId: '../x', workflowId: 'do-it' }).expect(400));
    record(await api().post('/api/workflow-runs/R-1/advance').send({ force: 'yes' }).expect(400));
    record(await api().get('/api/workflow-runs?itemId=a%20b').expect(400));
  });

  it('never sends a token', async () => {
    const run = record(await api().post('/api/workflow-runs').send({ itemId, workflowId: 'do-it' }).expect(201)).body;
    record(await api().get('/api/workflow-runs').expect(200));
    record(await api().get(`/api/workflow-runs/${run.id}`).expect(200));
    const records = readdirSync(dataDir).filter((n) => n.endsWith('.json'))
      .map((n) => JSON.parse(readFileSync(join(dataDir, n), 'utf8')) as { taskToken: string; agentToken: string });
    const secrets = [TOKEN, FAKE_GH_TOKEN, FAKE_OAUTH_TOKEN, ...records.flatMap((r) => [r.taskToken, r.agentToken])];
    for (const text of sent) for (const secret of secrets) expect(text).not.toContain(secret);
  });
});
