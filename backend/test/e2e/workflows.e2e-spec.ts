import { INestApplication } from '@nestjs/common';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
    sessions:
      - name: main
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
      workflows: { 'do-it.yaml': TWO_STEPS, 'bad.yaml': 'title: Bad\nsteps:\n  - id: x\n    title: X\n    stage: nowhere\n    gate: human\n    sessions: [{ name: main, prompt: p }]\n' },
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
        steps: [{ id: 'work', title: 'Work', stage: 'doing', gate: 'human', sessions: ['main'] }],
      }],
      refused: [{ file: 'bad.yaml', error: expect.stringContaining('bad.yaml') }],
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
