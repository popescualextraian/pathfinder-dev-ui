import { INestApplication } from '@nestjs/common';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TASK_LAUNCHER } from '../../src/engine/service/task-launcher';
import { describeWithBridge, LocalProcessLauncher, until } from '../helpers/local-process-launcher';
import { openSse } from '../helpers/sse-client';
import { setTestEnv } from '../helpers/test-env';

// The poller and the status stream against the real agentic-bridge and the fake agent (local
// launcher): a turn, an ASK: question and its answer reach the record and the stream by polling alone;
// the task is never read through the API in between.
describeWithBridge('task poller and status stream against the local launcher and the real bridge', () => {
  const launcher = new LocalProcessLauncher();
  let app: INestApplication;
  let dataDir: string;
  let id: string;
  let stream: ReturnType<typeof openSse>;

  const api = () => request(app.getHttpServer());
  const stored = () => JSON.parse(readFileSync(join(dataDir, `${id}.json`), 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const onStream = (what: string, match: (task: any) => boolean) => // eslint-disable-line @typescript-eslint/no-explicit-any
    stream.next((e) => e.event === 'task' && e.data.id === id && match(e.data), 15_000).catch((error: Error) => {
      throw new Error(`${what}: ${error.message}`);
    });

  beforeAll(async () => {
    dataDir = setTestEnv(2);
    process.env.ENGINE_LAUNCHER = 'local';
    process.env.ENGINE_POLL_SECONDS = '1';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(TASK_LAUNCHER).useValue(launcher).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    stream = openSse(app);
  });

  afterAll(async () => {
    stream?.close();
    delete process.env.ENGINE_POLL_SECONDS;
    await app?.close();
    await launcher.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('a turn ends in review with its whole last message', async () => {
    const res = await api().post('/api/tasks').send({ prompt: 'first prompt' });
    expect(res.status).toBe(201);
    id = res.body.id;
    const idle = await onStream('idle with the echo', (t) => t.state === 'idle' && String(t.lastMessage).includes('echo: first prompt'));
    expect(idle.data).toMatchObject({ section: 'in-review', closed: false });
    expect(stored()).toMatchObject({ lastState: 'idle', lastMessage: expect.stringContaining('echo: first prompt'), lastSeq: expect.any(Number) });
  });

  it('an ASK: question arrives under needs-you, and its answer takes it away', async () => {
    expect((await api().post(`/api/tasks/${id}/prompt`).send({ text: 'ASK:Which one?' })).status).toBe(202);
    const asked = await onStream('the question', (t) => t.section === 'needs-you' && t.questions.length === 1);
    expect(asked.data.questions[0]).toMatchObject({ source: 'ask', text: 'Which one?' });
    expect(stored().lastStatus.questions).toHaveLength(1);

    expect((await api().post(`/api/tasks/${id}/answer`).send({ text: 'the first' })).status).toBe(202);
    const done = await onStream('the answer', (t) => t.state === 'idle' && t.questions.length === 0 && String(t.lastMessage).includes('the first'));
    expect(done.data.section).toBe('in-review');
    await until('record without questions', async () => stored().lastStatus.questions.length === 0);
  });

  it('closes the task: container and process gone, record kept in done, 409 on a prompt', async () => {
    const res = await api().post(`/api/tasks/${id}/close`);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ closed: true, section: 'done', state: 'stopped' });
    expect((await launcher.inspect(id)).exists).toBe(false);
    expect(await onStream('closed', (t) => t.closed === true)).toBeDefined();
    expect((await api().post(`/api/tasks/${id}/prompt`).send({ text: 'late' })).status).toBe(409);
    expect((await api().get(`/api/tasks/${id}`)).body).toMatchObject({ closed: true, lastMessage: expect.stringContaining('the first') });
    expect((await api().delete(`/api/tasks/${id}`)).status).toBe(204);
    expect((await api().get(`/api/tasks/${id}`)).status).toBe(404);
  });

  it('closes a task that is running a long turn', async () => {
    const res = await api().post('/api/tasks').send({ prompt: 'SLEEP:30000' });
    const running = res.body.id as string;
    const closed = await api().post(`/api/tasks/${running}/close`);
    expect(closed.status).toBe(202);
    expect(closed.body).toMatchObject({ closed: true, section: 'done' });
    expect((await launcher.inspect(running)).exists).toBe(false);
  });
});
