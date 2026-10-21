import { BadGatewayException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TaskUpdates, TaskView, WorktreeFileTooLargeError } from '../../../../src/engine';
import { EngineScheduledTasks } from '../../../../src/integration/schedule/engine-scheduled-tasks';
import { ScheduledTaskEnd, ScheduledTaskRefusedError, ScheduledTaskStart, ScheduleRunner } from '../../../../src/schedule';
import { ScheduleLocks } from '../../../../src/schedule/service/schedule-locks';
import { TasksService } from '../../../../src/engine/service/tasks.service';
import { TaskCostService } from '../../../../src/engine/service/cost/task-cost.service';
import { config, fakeBridge, fakeLauncher, fakeRecords, record } from '../../engine/service/helpers';
import { FakeClock, MemoryScheduleRepository } from '../../../helpers/fake-schedule';

function view(patch: Partial<TaskView> = {}): TaskView {
  return {
    id: 'T-1', title: 'Nightly deps', prompt: 'Update', repository: 'repo', repoUrl: 'https://example.test/r.git',
    branch: 'agentic/T-1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    state: 'running', section: 'working', questions: [], sessions: [], closed: false,
    scheduleId: 'nightly', scheduleTitle: 'Nightly deps', ...patch,
  };
}

const START: ScheduledTaskStart = {
  scheduleId: 'nightly', title: 'Nightly deps', repository: 'repo', prompt: 'Update', timeoutSeconds: 300,
};

function make() {
  const tasks = {
    start: jest.fn().mockResolvedValue(view({ state: 'starting' })),
    get: jest.fn().mockResolvedValue(view()),
    readTaskFile: jest.fn().mockResolvedValue('Summary text'),
  };
  const updates = new TaskUpdates();
  return { tasks, updates, adapter: new EngineScheduledTasks(tasks as never, updates) };
}

describe('EngineScheduledTasks', () => {
  describe('start', () => {
    it('starts a scheduled task in the schedule\'s repository with ref, model, timeout and schedule id/title', async () => {
      const { tasks, adapter } = make();
      expect(await adapter.start({ ...START, ref: 'main', model: 'sonnet' })).toEqual({ taskId: 'T-1', branch: 'agentic/T-1' });
      expect(tasks.start).toHaveBeenCalledWith({
        title: 'Nightly deps', prompt: 'Update', repository: 'repo', repoRef: 'main', model: 'sonnet',
        scheduled: { runTimeoutSeconds: 300 }, scheduleId: 'nightly', scheduleTitle: 'Nightly deps',
      });
    });

    it('leaves ref and model out when not given', async () => {
      const { tasks, adapter } = make();
      await adapter.start(START);
      expect(tasks.start).toHaveBeenCalledWith({
        title: 'Nightly deps', prompt: 'Update', repository: 'repo', scheduled: { runTimeoutSeconds: 300 }, scheduleId: 'nightly', scheduleTitle: 'Nightly deps',
      });
    });

    it('maps the engine\'s 409 to a cap refusal and other HTTP errors to other refusals', async () => {
      const { tasks, adapter } = make();
      tasks.start.mockRejectedValueOnce(new ConflictException('At most 2 tasks can run at once'));
      await expect(adapter.start(START)).rejects.toEqual(expect.objectContaining({ kind: 'cap', message: 'At most 2 tasks can run at once' }));
      tasks.start.mockRejectedValueOnce(new BadRequestException('Unknown repository repo'));
      const other = adapter.start(START);
      await expect(other).rejects.toBeInstanceOf(ScheduledTaskRefusedError);
      await expect(other).rejects.toEqual(expect.objectContaining({ kind: 'other', message: 'Unknown repository repo' }));
      tasks.start.mockRejectedValueOnce(new Error('boom'));
      await expect(adapter.start(START)).rejects.not.toBeInstanceOf(ScheduledTaskRefusedError);
    });

    it('follows a task that was created but whose bridge did not answer (502)', async () => {
      const { tasks, updates, adapter } = make();
      tasks.start.mockImplementationOnce(async () => {
        updates.changed(view({ id: 'T-7', branch: 'agentic/T-7', state: 'starting' }));
        throw new BadGatewayException('bridge did not become ready');
      });
      expect(await adapter.start(START)).toEqual({ taskId: 'T-7', branch: 'agentic/T-7' });
    });
  });

  describe('ends', () => {
    it('announces scheduled tasks that left the live states or were closed, with the last message', () => {
      const { updates, adapter } = make();
      const seen: ScheduledTaskEnd[] = [];
      const sub = adapter.ends.subscribe((end) => seen.push(end));
      updates.changed(view({ state: 'running' }));
      updates.changed(view({ id: 'T-2', scheduleId: undefined, state: 'stopped' }));
      updates.changed(view({ state: 'stopped', reason: 'scheduled-done', lastMessage: 'bye' }));
      updates.changed(view({ id: 'T-3', state: 'idle', closed: true }));
      updates.removed('T-1');
      sub.unsubscribe();
      expect(seen).toEqual([
        { taskId: 'T-1', scheduleId: 'nightly', state: 'stopped', reason: 'scheduled-done', lastMessage: 'bye' },
        { taskId: 'T-3', scheduleId: 'nightly', state: 'stopped', reason: 'the task was closed' },
      ]);
    });
  });

  describe('get', () => {
    it('gives the state and whether the run ended; undefined for a task that is gone', async () => {
      const { tasks, adapter } = make();
      expect(await adapter.get('T-1')).toEqual({ taskId: 'T-1', state: 'running', ended: false });
      tasks.get.mockResolvedValueOnce(view({ state: 'failed', reason: 'crash' }));
      expect(await adapter.get('T-1')).toEqual({ taskId: 'T-1', state: 'failed', reason: 'crash', ended: true });
      tasks.get.mockRejectedValueOnce(new NotFoundException());
      expect(await adapter.get('T-1')).toBeUndefined();
    });
  });

  describe('readResult', () => {
    it('reads result.md and the last message', async () => {
      const { tasks, adapter } = make();
      tasks.get.mockResolvedValue(view({ state: 'stopped', reason: 'scheduled-done', lastMessage: 'bye' }));
      expect(await adapter.readResult('T-1')).toEqual({ state: 'stopped', reason: 'scheduled-done', summary: 'Summary text', lastMessage: 'bye' });
      expect(tasks.readTaskFile).toHaveBeenCalledWith('T-1', 'result.md');
    });

    it('tolerates a missing result.md, one too large and one that cannot be read', async () => {
      const { tasks, adapter } = make();
      tasks.get.mockResolvedValue(view({ state: 'stopped', reason: 'timeout' }));
      tasks.readTaskFile.mockResolvedValueOnce(null);
      expect(await adapter.readResult('T-1')).toEqual({ state: 'stopped', reason: 'timeout', summary: null, lastMessage: null });
      tasks.readTaskFile.mockRejectedValueOnce(new WorktreeFileTooLargeError('result.md', 'T-1', 65536));
      expect(await adapter.readResult('T-1')).toMatchObject({ summary: null, summaryProblem: 'result.md is larger than 64 KB' });
      tasks.readTaskFile.mockRejectedValueOnce(new Error('docker down'));
      expect(await adapter.readResult('T-1')).toMatchObject({ summary: null, summaryProblem: 'result.md could not be read: docker down' });
    });

    it('is undefined for a task that is gone', async () => {
      const { tasks, adapter } = make();
      tasks.get.mockRejectedValueOnce(new NotFoundException());
      expect(await adapter.readResult('T-1')).toBeUndefined();
    });
  });
});

// The adapter on the real TasksService (fake records, launcher and bridge) with the runner's reconcile at startup.
describe('EngineScheduledTasks with the engine: a run that ended while the app was down', () => {
  const ID = 'T-20260101-abcd';

  async function restart(launcherOver: Record<string, unknown>, lastState = 'running') {
    const records = fakeRecords([record({ id: ID, lastState, scheduled: { runTimeoutSeconds: 600 }, scheduleId: 'nightly', scheduleTitle: 'Nightly deps' })]);
    const launcher = fakeLauncher(launcherOver);
    const updates = new TaskUpdates();
    const tasks = new TasksService(records as never, launcher as never, (() => fakeBridge()) as never, config, updates,
      new TaskCostService(records as never, launcher as never), { waitTimeoutMs: 50, waitIntervalMs: 1 });
    const adapter = new EngineScheduledTasks(tasks, updates);
    const repo = new MemoryScheduleRepository();
    await repo.save({
      id: 'nightly', title: 'Nightly deps', prompt: 'Update', repository: 'repo', when: { cron: '0 2 * * *' }, timeoutMinutes: 10, enabled: true,
      nextRunAt: '2099-01-01T02:00:00+00:00', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      results: [{ firedAt: '2026-01-01T02:00:00.000Z', trigger: 'time', outcome: 'running', taskId: ID }],
    });
    const runner = new ScheduleRunner(adapter, repo, { dataDir: '/unused', timezone: 'UTC', tickSeconds: 3600 }, new ScheduleLocks(), new FakeClock(Date.parse('2026-01-01T03:00:00.000Z')));
    await runner.onModuleInit();
    await runner.settled();
    return { records, updates, adapter, repo, runner };
  }

  let stop: (() => void) | undefined;
  afterEach(() => stop?.());

  const files = (map: Record<string, string>) => jest.fn(async (_id: string, name: string) => map[name] ?? null);
  const exited = { inspect: jest.fn(async () => ({ exists: true, running: false, bridgeUrl: '' })) };

  it('a container that is not running: the result is done with the summary of result.md (state from state.json), not failed', async () => {
    const readTaskFile = files({ 'state.json': JSON.stringify({ state: 'stopped', reason: 'scheduled-done' }), 'result.md': 'Updated 3 deps.' });
    const { repo, records, runner } = await restart({ ...exited, readTaskFile });
    stop = () => runner.onModuleDestroy();
    expect((await repo.get('nightly'))!.results[0]).toMatchObject({ outcome: 'done', summary: 'Updated 3 deps.', endedAt: expect.any(String) });
    expect(records.map.get(ID)).toMatchObject({ lastState: 'stopped', summaryLine: 'Updated 3 deps.' });
  });

  it('a run that waited on a question when its time limit was reached: timeout', async () => {
    const readTaskFile = files({ 'state.json': JSON.stringify({ state: 'stopped', reason: 'timeout' }), 'result.md': 'The time is up.' });
    const { repo, runner } = await restart({ ...exited, readTaskFile }, 'waiting');
    stop = () => runner.onModuleDestroy();
    expect((await repo.get('nightly'))!.results[0]).toMatchObject({ outcome: 'timeout', summary: 'The time is up.' });
  });

  it('a run still going stays running, and its later end completes the result', async () => {
    let running = true;
    const readTaskFile = files({ 'state.json': JSON.stringify({ state: 'stopped', reason: 'scheduled-done' }), 'result.md': 'Done late.' });
    const inspect = jest.fn(async () => ({ exists: true, running, bridgeUrl: '' }));
    const { repo, runner, adapter } = await restart({ inspect, readTaskFile });
    stop = () => runner.onModuleDestroy();
    expect((await repo.get('nightly'))!.results[0]).toMatchObject({ outcome: 'running' });
    // The container exits later; the engine records the end (here through a read, as a wake or the poller would).
    running = false;
    await adapter.get(ID);
    await runner.settled();
    expect((await repo.get('nightly'))!.results[0]).toMatchObject({ outcome: 'done', summary: 'Done late.' });
  });
});
