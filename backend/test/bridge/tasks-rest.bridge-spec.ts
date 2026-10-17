import { INestApplication } from '@nestjs/common';
import { rmSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TASK_LAUNCHER } from '../../src/service/tasks/task-launcher';
import { describeWithBridge, LocalProcessLauncher, until } from '../helpers/local-process-launcher';
import { setTestEnv } from '../helpers/test-env';

// The REST API of the whole app (as main.ts and the e2e tests boot it) with the local launcher:
// real bridge processes and the fake agent behind supertest.
describeWithBridge('tasks REST API against the local launcher and the real bridge', () => {
  const launcher = new LocalProcessLauncher();
  let app: INestApplication;
  let dataDir: string;
  let id: string;

  const api = () => request(app.getHttpServer());
  const view = async () => (await api().get(`/api/tasks/${id}`)).body;
  const inState = (state: string) =>
    until(`state ${state}`, async () => {
      const v = await view();
      return v.state === state ? v : undefined;
    });
  const echoed = (text: string) =>
    until(`echo of ${text}`, async () => {
      const res = await api().get(`/api/tasks/${id}/events`);
      return JSON.stringify(res.body).includes(`echo: ${text}`);
    });

  beforeAll(async () => {
    dataDir = setTestEnv(2);
    process.env.ENGINE_LAUNCHER = 'local';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(TASK_LAUNCHER).useValue(launcher).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await launcher.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('POST /api/tasks starts a task that echoes its prompt', async () => {
    const res = await api().post('/api/tasks').send({ prompt: 'first prompt' });
    expect(res.status).toBe(201);
    id = res.body.id;
    expect(res.body.branch).toBe(`agentic/${id}`);
    expect(res.body).not.toHaveProperty('taskToken');
    await inState('idle');
    await echoed('first prompt');
  });

  it('POST prompt is echoed', async () => {
    expect((await api().post(`/api/tasks/${id}/prompt`).send({ text: 'second prompt' })).status).toBe(202);
    await echoed('second prompt');
    await inState('idle');
  });

  it('ASK: shows a question and answer takes it', async () => {
    await api().post(`/api/tasks/${id}/prompt`).send({ text: 'ASK:Which one?' });
    const asked = await until('question', async () => {
      const v = await view();
      return v.questions.length > 0 ? v : undefined;
    });
    expect(asked.questions[0].text).toBe('Which one?');
    expect((await api().post(`/api/tasks/${id}/answer`).send({ text: 'the first' })).status).toBe(202);
    await until('no open questions', async () => (await view()).questions.length === 0);
    await inState('idle');
  });

  it('refuses DELETE while running, stops, then DELETE removes the task', async () => {
    expect((await api().delete(`/api/tasks/${id}`)).status).toBe(409);
    expect((await api().post(`/api/tasks/${id}/stop`)).status).toBe(202);
    await inState('stopped');
    expect((await api().post(`/api/tasks/${id}/prompt`).send({ text: 'late' })).status).toBe(409);
    expect((await api().delete(`/api/tasks/${id}`)).status).toBe(204);
    expect((await api().get(`/api/tasks/${id}`)).status).toBe(404);
    expect((await api().get('/api/tasks')).body).toEqual([]);
    expect((await launcher.inspect(id)).exists).toBe(false);
  });
});
