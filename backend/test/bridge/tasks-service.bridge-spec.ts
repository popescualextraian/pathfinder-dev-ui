import { rmSync } from 'node:fs';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { firstValueFrom } from 'rxjs';
import { filter, take, toArray } from 'rxjs/operators';
import { AppModule } from '../../src/app.module';
import { BridgeEvent } from '../../src/service/tasks/bridge-client';
import { TASK_LAUNCHER } from '../../src/service/tasks/task-launcher';
import { TaskEventsService } from '../../src/service/tasks/task-events.service';
import { TasksService, TaskView } from '../../src/service/tasks/tasks.service';
import { describeWithBridge, LocalProcessLauncher, until } from '../helpers/local-process-launcher';
import { setTestEnv } from '../helpers/test-env';

const mentions = (e: BridgeEvent, text: string) => e.type === 'message' && JSON.stringify(e.data).includes(text);

// The task service with real Nest wiring, real BridgeClient and the real bridge behind a
// LocalProcessLauncher.
describeWithBridge('TasksService against the real bridge', () => {
  const launcher = new LocalProcessLauncher();
  let moduleRef: TestingModule;
  let tasks: TasksService;
  let events: TaskEventsService;
  let task: TaskView;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = setTestEnv(2);
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(TASK_LAUNCHER).useValue(launcher).compile();
    await moduleRef.init();
    tasks = moduleRef.get(TasksService);
    events = moduleRef.get(TaskEventsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await launcher.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function inState(state: string): Promise<TaskView> {
    return until(`state ${state}`, async () => {
      const view = await tasks.get(task.id);
      return view.state === state ? view : undefined;
    });
  }

  it('starts a task and waits for the bridge', async () => {
    task = await tasks.start({ prompt: 'start working' });
    expect(task.branch).toBe(`agentic/${task.id}`);
    expect(task).not.toHaveProperty('bridgeUrl');
    await inState('idle');
    expect((await tasks.events(task.id, 0)).some((e) => mentions(e, 'echo: start working'))).toBe(true);
  });

  it('prompts and sees the echo', async () => {
    await tasks.prompt(task.id, 'hello service');
    await until('echo', async () => (await tasks.events(task.id, 0)).some((e) => mentions(e, 'echo: hello service')));
    await inState('idle');
  });

  it('shows an ASK: question and answers the oldest by default', async () => {
    await tasks.prompt(task.id, 'ASK:Pick one');
    const view = await until('question', async () => {
      const v = await tasks.get(task.id);
      return v.questions.length > 0 ? v : undefined;
    });
    expect(view.questions[0].text).toBe('Pick one');
    const after = await tasks.answer(task.id, { text: 'option a' });
    expect(after.questions).toEqual([]);
    await inState('idle');
  });

  it('cancels a SLEEP: turn', async () => {
    await tasks.prompt(task.id, 'SLEEP:30000');
    await inState('running');
    await tasks.cancel(task.id);
    await inState('idle');
  });

  it('serves events(since) and the live stream (backlog then live)', async () => {
    const all = await tasks.events(task.id, 0);
    const mid = all[1].seq;
    expect((await tasks.events(task.id, mid)).map((e) => e.seq)).toEqual(all.filter((e) => e.seq > mid).map((e) => e.seq));

    const stream = await events.stream(task.id, mid);
    const collected = firstValueFrom(stream.pipe(filter((e) => mentions(e, 'echo: streamed live')), take(1)));
    const backlog = firstValueFrom(stream.pipe(take(all.filter((e) => e.seq > mid).length), toArray()));
    expect((await backlog)[0].seq).toBe(mid + 1);
    await tasks.prompt(task.id, 'streamed live');
    expect((await collected).type).toBe('message');
    await inState('idle');
  });

  it('refuses to remove a running task, then stops and removes it', async () => {
    await expect(tasks.remove(task.id)).rejects.toBeInstanceOf(ConflictException);
    const stopped = await tasks.stop(task.id);
    expect(stopped.state).toBe('stopped');
    expect((await tasks.get(task.id)).state).toBe('stopped');
    expect((await launcher.inspect(task.id)).running).toBe(false);
    await tasks.remove(task.id);
    expect(await tasks.list()).toEqual([]);
    expect((await launcher.inspect(task.id)).exists).toBe(false);
  });
});
