import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { SCHEDULE_CONFIG, ScheduleConfig } from '../../commons/schedule-config';
import type { ScheduleRecord, ScheduleResult, ScheduleTrigger } from './schedule';
import { SCHEDULE_CLOCK, ScheduleClock, SYSTEM_CLOCK } from './schedule-clock';
import { ScheduleNotFoundError } from './schedule-errors';
import { ScheduleLocks } from './schedule-locks';
import { completeResult, PREVIOUS_RUN_STILL_RUNS, RUNNING_CAP_REACHED } from './schedule-result';
import { nextRunAt } from './schedule-time';
import { SCHEDULE_REPOSITORY, ScheduleRepository } from './schedule.repository';
import { SCHEDULED_TASKS, ScheduledTaskEnd, ScheduledTaskRefusedError, ScheduledTasks } from './scheduled-tasks';

const message = (error: unknown): string => (error instanceof Error ? error.message : 'unknown error');

/**
 * Fires schedules: a tick every SCHEDULES_TICK_SECONDS looks for enabled schedules whose nextRunAt has come, starts
 * their runs (one tick at a time; a busy tick makes the next one skip), records each firing as a result and saves the
 * schedule with its next time before it is done. Captures the end of each run (from ScheduledTasks.ends, and at
 * startup for runs that ended while the app was down). Work on one schedule is serialized (ScheduleLocks).
 */
@Injectable()
export class ScheduleRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduleRunner.name);
  private timer?: ReturnType<typeof setInterval>;
  private subscription?: { unsubscribe(): void };
  private ticking = false;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    @Inject(SCHEDULED_TASKS) private readonly tasks: ScheduledTasks,
    @Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository,
    @Inject(SCHEDULE_CONFIG) private readonly config: ScheduleConfig,
    private readonly locks: ScheduleLocks,
    @Optional() @Inject(SCHEDULE_CLOCK) private readonly clock: ScheduleClock = SYSTEM_CLOCK,
  ) {}

  // Follow run ends first (so none is lost), then reconcile the runs recorded as running, then tick.
  async onModuleInit(): Promise<void> {
    this.subscription = this.tasks.ends.subscribe((end) => this.track(this.onEnded(end)));
    await this.reconcile();
    this.timer = setInterval(() => this.track(this.tick()), this.config.tickSeconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.subscription?.unsubscribe();
    this.subscription = undefined;
  }

  /** Resolves when the work started so far (ticks, captures) is done. */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  private track(work: Promise<unknown>): void {
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }

  /** One look for due schedules; returns at once while the previous tick still works. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.clock.now().getTime();
      let all: ScheduleRecord[];
      try {
        all = await this.schedules.list();
      } catch (error) {
        this.logger.error(`Cannot list the schedules: ${message(error)}`);
        return;
      }
      const due = all.filter((s) => s.enabled && s.nextRunAt !== null && Date.parse(s.nextRunAt) <= now);
      await Promise.all(due.map((s) => this.locks.run(s.id, () => this.fireDue(s.id)).catch((error: unknown) => {
        this.logger.error(`Schedule ${s.id} could not fire: ${message(error)}`);
      })));
    } finally {
      this.ticking = false;
    }
  }

  /** "Run now": fires at once with trigger manual, by the same rules; nextRunAt stays. Also on a disabled schedule. */
  runNow(id: string): Promise<ScheduleResult> {
    return this.locks.run(id, async () => {
      const record = await this.schedules.get(id);
      if (!record) throw new ScheduleNotFoundError(`Schedule ${id} not found`);
      const result = await this.fire(record, 'manual', this.clock.now());
      record.results.unshift(result);
      await this.schedules.save(record);
      return result;
    });
  }

  // Under the schedule's lock; read again, as it may have changed since the tick listed it.
  private async fireDue(id: string): Promise<void> {
    const record = await this.schedules.get(id);
    if (!record || !record.enabled || record.nextRunAt === null) return;
    const now = this.clock.now();
    const dueAt = Date.parse(record.nextRunAt);
    if (dueAt > now.getTime()) return;

    const late = now.getTime() - dueAt > 2 * this.config.tickSeconds * 1000;
    const result: ScheduleResult = late
      ? { firedAt: now.toISOString(), trigger: 'time', outcome: 'missed', reason: `it was due at ${record.nextRunAt}; missed times are not caught up` }
      : await this.fire(record, 'time', now);
    record.results.unshift(result);
    if (record.when.at !== undefined) {
      // A one-off is done once its time has come (fired or missed); it is kept for its results.
      record.enabled = false;
      record.nextRunAt = null;
    } else {
      // From the time it fired, so a start that took long does not fire it twice.
      record.nextRunAt = nextRunAt(record.when, this.config.timezone, now);
    }
    await this.schedules.save(record);
  }

  private async fire(record: ScheduleRecord, trigger: ScheduleTrigger, now: Date): Promise<ScheduleResult> {
    const firedAt = now.toISOString();
    if (record.results.some((r) => r.outcome === 'running')) return { firedAt, trigger, outcome: 'skipped', reason: PREVIOUS_RUN_STILL_RUNS };
    try {
      const started = await this.tasks.start({
        scheduleId: record.id, title: record.title, repository: record.repository, prompt: record.prompt,
        timeoutSeconds: record.timeoutMinutes * 60,
        ...(record.ref !== undefined && { ref: record.ref }),
        ...(record.model !== undefined && { model: record.model }),
      });
      return { firedAt, trigger, outcome: 'running', taskId: started.taskId, ...(started.branch !== undefined && { branch: started.branch }) };
    } catch (error) {
      if (error instanceof ScheduledTaskRefusedError && error.kind === 'cap') return { firedAt, trigger, outcome: 'skipped', reason: RUNNING_CAP_REACHED };
      this.logger.warn(`Schedule ${record.id}: the task was refused: ${message(error)}`);
      return { firedAt, trigger, outcome: 'refused', reason: message(error) };
    }
  }

  private onEnded(end: ScheduledTaskEnd): Promise<void> {
    return this.locks.run(end.scheduleId, async () => {
      const record = await this.schedules.get(end.scheduleId);
      if (!record) return;
      const index = record.results.findIndex((r) => r.taskId === end.taskId && r.outcome === 'running');
      if (index < 0) return;
      record.results[index] = completeResult(record.results[index], await this.tasks.readResult(end.taskId), this.clock.now().toISOString());
      await this.schedules.save(record);
    }).catch((error: unknown) => {
      this.logger.error(`Schedule ${end.scheduleId}: the end of task ${end.taskId} could not be recorded: ${message(error)}`);
    });
  }

  // At startup: results still `running` whose task ended (or vanished) while the app was down are completed.
  private async reconcile(): Promise<void> {
    let all: ScheduleRecord[];
    try {
      all = await this.schedules.list();
    } catch (error) {
      this.logger.error(`Cannot list the schedules: ${message(error)}`);
      return;
    }
    await Promise.all(all.filter((s) => s.results.some((r) => r.outcome === 'running')).map((s) => this.locks.run(s.id, async () => {
      const record = await this.schedules.get(s.id);
      if (!record) return;
      let changed = false;
      for (let i = 0; i < record.results.length; i++) {
        const result = record.results[i];
        if (result.outcome !== 'running' || result.taskId === undefined) continue;
        const status = await this.tasks.get(result.taskId);
        if (status !== undefined && !status.ended) continue;
        const ended = status === undefined ? undefined : await this.tasks.readResult(result.taskId);
        record.results[i] = completeResult(result, ended, this.clock.now().toISOString());
        changed = true;
      }
      if (changed) await this.schedules.save(record);
    }).catch((error: unknown) => {
      this.logger.error(`Schedule ${s.id}: its running results could not be checked: ${message(error)}`);
    })));
  }
}
