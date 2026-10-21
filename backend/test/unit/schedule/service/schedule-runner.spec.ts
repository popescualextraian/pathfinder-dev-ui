import { ScheduleConfig } from '../../../../src/commons/schedule-config';
import {
  MAX_SUMMARY_LENGTH, PREVIOUS_RUN_STILL_RUNS, RUNNING_CAP_REACHED, ScheduledTaskRefusedError, ScheduleNotFoundError, ScheduleRecord,
  ScheduleRunner, TASK_GONE,
} from '../../../../src/schedule';
import { ScheduleLocks } from '../../../../src/schedule/service/schedule-locks';
import { capRefusal, FakeClock, FakeScheduledTasks, MemoryScheduleRepository } from '../../../helpers/fake-schedule';

const CONFIG: ScheduleConfig = { dataDir: '/unused', timezone: 'UTC', tickSeconds: 30 };
const NOW = '2026-10-21T10:00:00.000Z';

function schedule(patch: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: 'nightly', title: 'Nightly deps', prompt: 'Update the deps', repository: 'repo', when: { cron: '0 * * * *' },
    timeoutMinutes: 120, enabled: true, nextRunAt: '2026-10-21T10:00:00+00:00',
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', results: [], ...patch,
  };
}

async function make(records: ScheduleRecord[] = [schedule()], now = NOW) {
  const repo = new MemoryScheduleRepository();
  for (const r of records) await repo.save(r);
  repo.saves = 0;
  const tasks = new FakeScheduledTasks();
  const clock = new FakeClock(Date.parse(now));
  const runner = new ScheduleRunner(tasks, repo, CONFIG, new ScheduleLocks(), clock);
  const stored = async (id = 'nightly') => (await repo.get(id))!;
  return { repo, tasks, clock, runner, stored };
}

describe('ScheduleRunner', () => {
  afterEach(() => jest.useRealTimers());

  describe('tick', () => {
    it('fires a due schedule: starts the scheduled task, records a running result and saves the next time', async () => {
      const { tasks, runner, stored, repo } = await make([schedule({ ref: 'main', model: 'sonnet', timeoutMinutes: 5 })], '2026-10-21T10:00:10.000Z');
      await runner.tick();
      expect(tasks.starts).toEqual([{
        scheduleId: 'nightly', title: 'Nightly deps', repository: 'repo', ref: 'main', model: 'sonnet', prompt: 'Update the deps', timeoutSeconds: 300,
      }]);
      const record = await stored();
      expect(record.results).toEqual([{ firedAt: '2026-10-21T10:00:10.000Z', trigger: 'time', outcome: 'running', taskId: 'T-1', branch: 'agentic/T-1' }]);
      expect(record.nextRunAt).toBe('2026-10-21T11:00:00+00:00');
      expect(record.enabled).toBe(true);
      expect(repo.saves).toBe(1);
    });

    it('leaves out ref and model when the schedule has none', async () => {
      const { tasks, runner } = await make();
      await runner.tick();
      expect(tasks.starts[0]).toEqual({ scheduleId: 'nightly', title: 'Nightly deps', repository: 'repo', prompt: 'Update the deps', timeoutSeconds: 7200 });
    });

    it('does nothing for a schedule not yet due, disabled, or without a next time', async () => {
      const { tasks, runner, repo } = await make([
        schedule({ id: 'later', nextRunAt: '2026-10-21T10:00:01+00:00' }),
        schedule({ id: 'off', enabled: false }),
        schedule({ id: 'none', nextRunAt: null }),
      ]);
      await runner.tick();
      expect(tasks.starts).toEqual([]);
      expect(repo.saves).toBe(0);
    });

    it('skips while the previous run still runs, and moves to the next time', async () => {
      const running = { firedAt: '2026-10-21T09:00:00.000Z', trigger: 'time' as const, outcome: 'running' as const, taskId: 'T-0' };
      const { tasks, runner, stored } = await make([schedule({ results: [running] })]);
      await runner.tick();
      expect(tasks.starts).toEqual([]);
      const record = await stored();
      expect(record.results).toEqual([{ firedAt: NOW, trigger: 'time', outcome: 'skipped', reason: PREVIOUS_RUN_STILL_RUNS }, running]);
      expect(record.nextRunAt).toBe('2026-10-21T11:00:00+00:00');
    });

    it('skips when the running cap is reached', async () => {
      const { tasks, runner, stored } = await make();
      tasks.refuse = capRefusal();
      await runner.tick();
      expect((await stored()).results).toEqual([{ firedAt: NOW, trigger: 'time', outcome: 'skipped', reason: RUNNING_CAP_REACHED }]);
      expect((await stored()).nextRunAt).toBe('2026-10-21T11:00:00+00:00');
    });

    it('records any other refusal as refused with the engine\'s message', async () => {
      const { tasks, runner, stored } = await make();
      tasks.refuse = new ScheduledTaskRefusedError('other', 'Unknown repository repo');
      await runner.tick();
      expect((await stored()).results).toEqual([{ firedAt: NOW, trigger: 'time', outcome: 'refused', reason: 'Unknown repository repo' }]);
    });

    it('records an unexpected start error as refused too', async () => {
      const { tasks, runner, stored } = await make();
      tasks.refuse = new Error('disk full');
      await runner.tick();
      expect((await stored()).results[0]).toMatchObject({ outcome: 'refused', reason: 'disk full' });
    });

    it('records missed when more than two ticks late, without starting, and moves to the next time', async () => {
      const { tasks, runner, stored } = await make([schedule()], '2026-10-21T10:01:00.001Z');
      await runner.tick();
      expect(tasks.starts).toEqual([]);
      const record = await stored();
      expect(record.results).toEqual([{ firedAt: '2026-10-21T10:01:00.001Z', trigger: 'time', outcome: 'missed', reason: expect.stringContaining('2026-10-21T10:00:00+00:00') }]);
      expect(record.nextRunAt).toBe('2026-10-21T11:00:00+00:00');
    });

    it('still fires at exactly two ticks late', async () => {
      const { tasks, runner } = await make([schedule()], '2026-10-21T10:01:00.000Z');
      await runner.tick();
      expect(tasks.starts).toHaveLength(1);
    });

    it('does not catch up missed times: after a long downtime one missed result and the next time from now', async () => {
      const { runner, stored } = await make([schedule()], '2026-10-23T07:30:00.000Z');
      await runner.tick();
      const record = await stored();
      expect(record.results.map((r) => r.outcome)).toEqual(['missed']);
      expect(record.nextRunAt).toBe('2026-10-23T08:00:00+00:00');
    });

    it('a one-off disables itself after it fired, and keeps its result', async () => {
      const { tasks, runner, stored } = await make([schedule({ when: { at: '2026-10-21T10:00' } })]);
      await runner.tick();
      expect(tasks.starts).toHaveLength(1);
      const record = await stored();
      expect(record).toMatchObject({ enabled: false, nextRunAt: null });
      expect(record.results[0]).toMatchObject({ outcome: 'running', taskId: 'T-1' });
      await runner.tick();
      expect(tasks.starts).toHaveLength(1);
    });

    it('a missed one-off disables itself too', async () => {
      const { runner, stored } = await make([schedule({ when: { at: '2026-10-21T10:00' } })], '2026-10-21T12:00:00.000Z');
      await runner.tick();
      expect(await stored()).toMatchObject({ enabled: false, nextRunAt: null, results: [{ outcome: 'missed' }] });
    });

    it('a one-off refused or skipped is disabled as well', async () => {
      const { tasks, runner, stored } = await make([schedule({ when: { at: '2026-10-21T10:00' } })]);
      tasks.refuse = capRefusal();
      await runner.tick();
      expect(await stored()).toMatchObject({ enabled: false, nextRunAt: null, results: [{ outcome: 'skipped' }] });
    });

    it('fires every due schedule of a tick', async () => {
      const { tasks, runner } = await make([schedule({ id: 'a' }), schedule({ id: 'b' })]);
      await runner.tick();
      expect(tasks.starts.map((s) => s.scheduleId).sort()).toEqual(['a', 'b']);
    });

    it('runs one tick at a time: a tick while one is busy does nothing', async () => {
      const { tasks, runner, stored } = await make();
      let open!: () => void;
      tasks.gate = new Promise((resolve) => { open = resolve; });
      const first = runner.tick();
      await new Promise((resolve) => setImmediate(resolve));
      await runner.tick();
      expect(tasks.starts).toHaveLength(1);
      open();
      await first;
      expect((await stored()).results).toHaveLength(1);
    });

    it('a failing save does not stop the other schedules', async () => {
      const { repo, tasks, runner } = await make([schedule({ id: 'a' }), schedule({ id: 'b' })]);
      const save = repo.save.bind(repo);
      repo.save = async (record) => {
        if (record.id === 'a') throw new Error('disk full');
        return save(record);
      };
      await runner.tick();
      expect(tasks.starts).toHaveLength(2);
      expect((await repo.get('b'))!.results).toHaveLength(1);
    });

    it('ticks every SCHEDULES_TICK_SECONDS after module init, with an unref\'d timer', async () => {
      jest.useFakeTimers({ now: Date.parse('2026-10-21T09:59:50.000Z') });
      const { tasks, runner, clock } = await make([schedule()], '2026-10-21T09:59:50.000Z');
      const unref = jest.spyOn(globalThis, 'setInterval');
      await runner.onModuleInit();
      expect(unref).toHaveBeenCalledWith(expect.any(Function), 30_000);
      await jest.advanceTimersByTimeAsync(29_000);
      expect(tasks.starts).toHaveLength(0);
      clock.advance(30_000);
      await jest.advanceTimersByTimeAsync(1_000);
      await runner.settled();
      expect(tasks.starts).toHaveLength(1);
      runner.onModuleDestroy();
      clock.advance(3600_000);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(tasks.starts).toHaveLength(1);
      unref.mockRestore();
    });
  });

  describe('run now', () => {
    it('fires at once with trigger manual and leaves nextRunAt as it was, also on a disabled schedule', async () => {
      const { tasks, runner, stored } = await make([schedule({ enabled: false, nextRunAt: null })]);
      const result = await runner.runNow('nightly');
      expect(result).toEqual({ firedAt: NOW, trigger: 'manual', outcome: 'running', taskId: 'T-1', branch: 'agentic/T-1' });
      expect(tasks.starts).toHaveLength(1);
      expect(await stored()).toMatchObject({ enabled: false, nextRunAt: null, results: [result] });
    });

    it('does not move the next time of an enabled schedule, nor disable a one-off', async () => {
      const { runner, stored } = await make([schedule({ when: { at: '2026-10-22T10:00' }, nextRunAt: '2026-10-22T10:00:00+00:00' })]);
      await runner.runNow('nightly');
      expect(await stored()).toMatchObject({ enabled: true, nextRunAt: '2026-10-22T10:00:00+00:00' });
    });

    it('follows the same rules: skipped while a run runs, skipped at the cap, refused', async () => {
      const { tasks, runner } = await make();
      await runner.onModuleInit();
      expect(await runner.runNow('nightly')).toMatchObject({ outcome: 'running' });
      expect(await runner.runNow('nightly')).toEqual({ firedAt: NOW, trigger: 'manual', outcome: 'skipped', reason: PREVIOUS_RUN_STILL_RUNS });
      tasks.end('T-1', { state: 'stopped', reason: 'scheduled-done', summary: 'ok', lastMessage: null });
      await runner.settled();
      tasks.refuse = capRefusal();
      expect(await runner.runNow('nightly')).toMatchObject({ outcome: 'skipped', reason: RUNNING_CAP_REACHED });
      tasks.refuse = new ScheduledTaskRefusedError('other', 'nope');
      expect(await runner.runNow('nightly')).toMatchObject({ outcome: 'refused', reason: 'nope' });
      runner.onModuleDestroy();
    });

    it('throws ScheduleNotFoundError for an unknown schedule', async () => {
      const { runner } = await make();
      await expect(runner.runNow('nope')).rejects.toBeInstanceOf(ScheduleNotFoundError);
    });
  });

  describe('result capture', () => {
    async function started() {
      const made = await make();
      await made.runner.onModuleInit();
      await made.runner.tick();
      made.clock.advance(5 * 60_000);
      return made;
    }

    it('done: stopped scheduled-done with the summary from result.md and endedAt', async () => {
      const { tasks, runner, stored } = await started();
      tasks.end('T-1', { state: 'stopped', reason: 'scheduled-done', summary: 'Updated 3 deps.\nPR #4', lastMessage: 'bye' });
      await runner.settled();
      runner.onModuleDestroy();
      expect((await stored()).results[0]).toEqual({
        firedAt: NOW, trigger: 'time', outcome: 'done', taskId: 'T-1', branch: 'agentic/T-1', summary: 'Updated 3 deps.\nPR #4', endedAt: '2026-10-21T10:05:00.000Z',
      });
    });

    it('timeout: stopped timeout keeps its summary', async () => {
      const { tasks, runner, stored } = await started();
      tasks.end('T-1', { state: 'stopped', reason: 'timeout', summary: 'Half done', lastMessage: null });
      await runner.settled();
      runner.onModuleDestroy();
      expect((await stored()).results[0]).toMatchObject({ outcome: 'timeout', summary: 'Half done', endedAt: '2026-10-21T10:05:00.000Z' });
    });

    it('failed: the task\'s reason', async () => {
      const { tasks, runner, stored } = await started();
      tasks.end('T-1', { state: 'failed', reason: 'the task ended without a state', summary: null, lastMessage: 'working on it' });
      await runner.settled();
      runner.onModuleDestroy();
      expect((await stored()).results[0]).toMatchObject({
        outcome: 'failed', reason: 'the task ended without a state', summary: 'No summary: the run wrote no result.md. Last message:\n\nworking on it',
      });
    });

    it('failed without a reason names the state', async () => {
      const { tasks, runner, stored } = await started();
      tasks.end('T-1', { state: 'interrupted', summary: null, lastMessage: null });
      await runner.settled();
      runner.onModuleDestroy();
      expect((await stored()).results[0]).toMatchObject({
        outcome: 'failed', reason: 'the task ended interrupted', summary: 'No summary: the run wrote no result.md, and no last message.',
      });
    });

    it('no summary: done without result.md is failed, with "No summary: …" and the last message', async () => {
      const { tasks, runner, stored } = await started();
      tasks.end('T-1', { state: 'stopped', reason: 'scheduled-done', summary: null, lastMessage: 'All green.' });
      await runner.settled();
      runner.onModuleDestroy();
      expect((await stored()).results[0]).toMatchObject({
        outcome: 'failed', reason: 'the run ended without a result: the run wrote no result.md',
        summary: 'No summary: the run wrote no result.md. Last message:\n\nAll green.',
      });
    });

    it('no summary: an empty result.md, or one too large to read, says why', async () => {
      const { tasks, runner, stored } = await started();
      tasks.end('T-1', { state: 'stopped', reason: 'timeout', summary: '  \n', lastMessage: 'x' });
      await runner.settled();
      expect((await stored()).results[0]).toMatchObject({ outcome: 'timeout', summary: 'No summary: result.md is empty. Last message:\n\nx' });

      await runner.runNow('nightly');
      tasks.end('T-2', { state: 'stopped', reason: 'scheduled-done', summary: null, summaryProblem: 'result.md is larger than 64 KB', lastMessage: 'y' });
      await runner.settled();
      runner.onModuleDestroy();
      expect((await stored()).results[0]).toMatchObject({ outcome: 'failed', summary: 'No summary: result.md is larger than 64 KB. Last message:\n\ny' });
    });

    it('cuts a summary to 64 KB', async () => {
      const { tasks, runner, stored } = await started();
      tasks.end('T-1', { state: 'stopped', reason: 'timeout', summary: null, lastMessage: 'z'.repeat(70 * 1024) });
      await runner.settled();
      runner.onModuleDestroy();
      const summary = (await stored()).results[0].summary!;
      expect(summary).toHaveLength(MAX_SUMMARY_LENGTH);
      expect(summary.endsWith('…')).toBe(true);
    });

    it('ignores a repeated end, an end of an unknown task and an end of a deleted schedule', async () => {
      const { tasks, runner, stored, repo } = await started();
      tasks.end('T-1', { state: 'stopped', reason: 'scheduled-done', summary: 'first', lastMessage: null });
      await runner.settled();
      const saves = repo.saves;
      tasks.end('T-1', { state: 'stopped', reason: 'closed', summary: 'second', lastMessage: null });
      tasks.endSubject.next({ taskId: 'T-9', scheduleId: 'nightly', state: 'stopped' });
      tasks.endSubject.next({ taskId: 'T-9', scheduleId: 'gone', state: 'stopped' });
      await runner.settled();
      runner.onModuleDestroy();
      expect(repo.saves).toBe(saves);
      expect((await stored()).results[0]).toMatchObject({ outcome: 'done', summary: 'first' });
    });

    it('waits for the firing to be saved when the run ends while it is being started', async () => {
      const { tasks, runner, stored } = await make();
      await runner.onModuleInit();
      let open!: () => void;
      tasks.gate = new Promise((resolve) => { open = resolve; });
      const tick = runner.tick();
      await new Promise((resolve) => setImmediate(resolve));
      open();
      // The task exists only after the gate; end it as soon as it does, before the tick saved.
      await new Promise((resolve) => setImmediate(resolve));
      tasks.end('T-1', { state: 'stopped', reason: 'scheduled-done', summary: 'quick', lastMessage: null });
      await tick;
      await runner.settled();
      runner.onModuleDestroy();
      expect((await stored()).results[0]).toMatchObject({ outcome: 'done', summary: 'quick' });
    });
  });

  describe('restart', () => {
    const running = (taskId: string, firedAt = '2026-10-21T09:00:00.000Z') => ({ firedAt, trigger: 'time' as const, outcome: 'running' as const, taskId });

    it('captures runs that ended while the app was down, keeps the ones still running, fails the ones whose task is gone', async () => {
      const { tasks, runner, stored, repo } = await make([
        schedule({ id: 'a', results: [running('T-a')] }),
        schedule({ id: 'b', results: [running('T-b')] }),
        schedule({ id: 'c', results: [running('T-c')] }),
      ], '2026-10-21T10:00:30.000Z');
      tasks.add('T-a', 'a', { state: 'stopped', reason: 'scheduled-done', ended: true }, { state: 'stopped', reason: 'scheduled-done', summary: 'did it', lastMessage: null });
      tasks.add('T-b', 'b', { state: 'running', ended: false });
      await runner.onModuleInit();
      runner.onModuleDestroy();
      expect((await stored('a')).results[0]).toMatchObject({ outcome: 'done', summary: 'did it', endedAt: '2026-10-21T10:00:30.000Z' });
      expect((await stored('b')).results[0]).toEqual(running('T-b'));
      expect((await stored('c')).results[0]).toMatchObject({ outcome: 'failed', reason: TASK_GONE, endedAt: '2026-10-21T10:00:30.000Z' });
      expect(repo.saves).toBe(2);
    });

    it('a run still running at restart is captured by its end event later', async () => {
      const { tasks, runner, stored } = await make([schedule({ results: [running('T-b')] })]);
      tasks.add('T-b', 'nightly', { state: 'running', ended: false });
      await runner.onModuleInit();
      tasks.end('T-b', { state: 'stopped', reason: 'timeout', summary: 'late', lastMessage: null });
      await runner.settled();
      runner.onModuleDestroy();
      expect((await stored()).results[0]).toMatchObject({ outcome: 'timeout', summary: 'late' });
    });

    it('a due schedule with a run still running after restart is skipped at the next tick', async () => {
      const { tasks, runner, stored } = await make([schedule({ results: [running('T-b')] })]);
      tasks.add('T-b', 'nightly', { state: 'running', ended: false });
      await runner.onModuleInit();
      await runner.tick();
      runner.onModuleDestroy();
      expect((await stored()).results[0]).toMatchObject({ outcome: 'skipped', reason: PREVIOUS_RUN_STILL_RUNS });
    });
  });
});
