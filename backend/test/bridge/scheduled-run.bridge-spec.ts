import { INestApplication } from '@nestjs/common';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TaskChange, TasksService, TaskUpdates } from '../../src/engine';
import { TASK_LAUNCHER } from '../../src/engine/service/task-launcher';
import { describeWithBridge, LocalProcessLauncher, until } from '../helpers/local-process-launcher';
import { setTestEnv } from '../helpers/test-env';

// A scheduled run against the real agentic-bridge and the fake agent (local launcher, AGENTIC_SCHEDULED=1):
// the bridge asks for the summary when the agent ends its turn, writes result.md, stops and exits; the poller
// finds the bridge gone and moves the task to the state of state.json, with the summary line, and stops polling.
describeWithBridge('a scheduled run against the local launcher and the real bridge', () => {
  const launcher = new LocalProcessLauncher();
  let app: INestApplication;
  let dataDir: string;
  let tasks: TasksService;
  const changes: TaskChange[] = [];

  const api = () => request(app.getHttpServer());
  const stored = (id: string) => JSON.parse(readFileSync(join(dataDir, `${id}.json`), 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    dataDir = setTestEnv(2);
    process.env.ENGINE_LAUNCHER = 'local';
    process.env.ENGINE_POLL_SECONDS = '1';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(TASK_LAUNCHER).useValue(launcher).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    tasks = app.get(TasksService);
    app.get(TaskUpdates).changes.subscribe((c) => changes.push(c));
  });

  afterAll(async () => {
    delete process.env.ENGINE_POLL_SECONDS;
    await app?.close();
    await launcher.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ends stopped (scheduled-done) after the summary, keeps the summary line, and is not polled any more', async () => {
    const started = await tasks.start({ prompt: 'tidy up', scheduled: { runTimeoutSeconds: 60 }, scheduleId: 'nightly', scheduleTitle: 'Nightly tidy' });
    const id = started.id;
    expect(started).toMatchObject({ scheduleId: 'nightly', scheduleTitle: 'Nightly tidy' });

    const ended = await until('the end announced on the change stream', async () =>
      changes.find((c) => c.kind === 'task' && c.task.id === id && c.task.state === 'stopped'), 30_000);
    if (ended.kind !== 'task') throw new Error('unexpected change');
    expect(ended.task).toMatchObject({ section: 'done', reason: 'scheduled-done', summaryLine: expect.stringContaining('echo: The run ends now') });

    const result = await tasks.readTaskFile(id, 'result.md');
    expect(result).toContain('echo: The run ends now');
    expect(ended.task.summaryLine!.length).toBeLessThanOrEqual(200);
    expect(stored(id)).toMatchObject({ lastState: 'stopped', summaryLine: ended.task.summaryLine, scheduleId: 'nightly' });
    expect(await launcher.inspect(id)).toMatchObject({ exists: true, running: false });

    // The poller leaves the ended task alone: no more reads of its state, no more writes or announcements
    // (once the cost rechecks after the end are done).
    await until('the cost rechecks done', async () => !stored(id).costRecheck, 10_000);
    const inspect = jest.spyOn(launcher, 'inspect');
    const readTaskFile = jest.spyOn(launcher, 'readTaskFile');
    const updatedAt = stored(id).updatedAt;
    const seen = changes.length;
    await new Promise((r) => setTimeout(r, 3500));
    expect(inspect).not.toHaveBeenCalled();
    expect(readTaskFile).not.toHaveBeenCalled();
    expect(stored(id).updatedAt).toBe(updatedAt);
    expect(changes.slice(seen).filter((c) => c.kind === 'task' && c.task.id === id)).toEqual([]);
    inspect.mockRestore();
    readTaskFile.mockRestore();

    // The run is over: no prompt, answer or session; the bridge is not started again.
    for (const [path, body] of [['prompt', { text: 'more' }], ['answer', { text: 'yes' }], ['sessions', { name: 'other' }]] as const) {
      const res = await api().post(`/api/tasks/${id}/${path}`).send(body);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/scheduled run has ended/);
    }
    expect(await launcher.inspect(id)).toMatchObject({ running: false });
    await expect(launcher.start(id)).rejects.toThrow(/scheduled run of task .* has ended/);

    const view = (await api().get(`/api/tasks/${id}`)).body;
    expect(view).toMatchObject({ state: 'stopped', section: 'done', scheduleId: 'nightly', scheduleTitle: 'Nightly tidy', summaryLine: ended.task.summaryLine });
    expect((await api().delete(`/api/tasks/${id}`)).status).toBe(204);
  });

  it('a run that is still working at the timeout ends stopped with reason timeout', async () => {
    const started = await tasks.start({ prompt: 'SLEEP:600000', scheduled: { runTimeoutSeconds: 60 }, scheduleId: 'slow' });
    const id = started.id;
    await until('the timeout end', async () => stored(id).lastState === 'stopped' && stored(id), 100_000);
    expect(stored(id)).toMatchObject({ lastStatus: { reason: 'timeout' }, summaryLine: expect.stringMatching(/.+/) });
    expect(await tasks.readTaskFile(id, 'result.md')).toContain('The time for this run is up');
    expect((await api().post(`/api/tasks/${id}/prompt`).send({ text: 'more' })).status).toBe(409);
    expect((await api().delete(`/api/tasks/${id}`)).status).toBe(204);
  }, 130_000);

  // The fake agent's ASK: ends its turn at once (the bridge then asks for the summary); a permission request holds the
  // turn, so the task waits on a question until the timeout cancels it, as a real agent's open question does.
  it('a run waiting on a question (nobody answers) is seen to end at the timeout: stopped, reason timeout', async () => {
    const started = await tasks.start({ prompt: 'PERMISSION:git push --force', scheduled: { runTimeoutSeconds: 60 }, scheduleId: 'asks' });
    const id = started.id;
    await until('the question', async () => stored(id).lastState === 'waiting' && stored(id), 30_000);
    const ended = await until('the timeout end', async () =>
      changes.find((c) => c.kind === 'task' && c.task.id === id && c.task.state === 'stopped'), 100_000);
    if (ended.kind !== 'task') throw new Error('unexpected change');
    expect(ended.task).toMatchObject({ section: 'done', reason: 'timeout', questions: [], summaryLine: expect.stringMatching(/.+/) });
    expect(stored(id)).toMatchObject({ lastState: 'stopped', lastStatus: { reason: 'timeout' } });
    expect((await api().post(`/api/tasks/${id}/answer`).send({ text: 'main' })).status).toBe(409);
    expect((await api().delete(`/api/tasks/${id}`)).status).toBe(204);
  }, 140_000);
});
