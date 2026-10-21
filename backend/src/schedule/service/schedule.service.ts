import { Inject, Injectable, Optional } from '@nestjs/common';
import { SCHEDULE_CONFIG, ScheduleConfig } from '../../commons/schedule-config';
import type { Schedule, ScheduleInput, ScheduleRecord, ScheduleResult } from './schedule';
import { SCHEDULE_CLOCK, ScheduleClock, SYSTEM_CLOCK } from './schedule-clock';
import { ScheduleInvalidError, ScheduleNotFoundError } from './schedule-errors';
import { proposeScheduleId } from './schedule-id';
import { ScheduleLocks } from './schedule-locks';
import { SCHEDULE_REPOSITORIES, ScheduleRepositories } from './schedule-repositories';
import { nextRunAt, previewNext, zonedToInstant } from './schedule-time';
import { SCHEDULE_REPOSITORY, ScheduleRepository } from './schedule.repository';
import { validateSchedule, validateWhen, ValidateResult } from './validate-schedule';

/** A schedule in the list: without its results but with the newest one. */
export interface ScheduleSummary extends Schedule {
  lastResult?: ScheduleResult;
}

export interface SchedulePreview {
  /** SCHEDULES_TIMEZONE. */
  zone: string;
  /** The next (up to) 3 times, ISO with the zone offset. */
  next: string[];
}

// Creates are serialized under this key, so two schedules with one title get different ids.
const CREATE_LOCK = '#create';

/** Create, replace, delete and read schedules (with their results); `when` previews. Firing is the ScheduleRunner's. */
@Injectable()
export class ScheduleService {
  constructor(
    @Inject(SCHEDULE_REPOSITORY) private readonly schedules: ScheduleRepository,
    @Inject(SCHEDULE_REPOSITORIES) private readonly repositories: ScheduleRepositories,
    @Inject(SCHEDULE_CONFIG) private readonly config: ScheduleConfig,
    private readonly locks: ScheduleLocks,
    @Optional() @Inject(SCHEDULE_CLOCK) private readonly clock: ScheduleClock = SYSTEM_CLOCK,
  ) {}

  get zone(): string {
    return this.config.timezone;
  }

  /** All schedules, oldest first, each with its newest result. */
  async list(): Promise<ScheduleSummary[]> {
    return (await this.schedules.list()).map(({ results, ...schedule }) => (results[0] ? { ...schedule, lastResult: results[0] } : schedule));
  }

  /** The schedule with its results, newest first. */
  async get(id: string): Promise<ScheduleRecord> {
    const record = await this.schedules.get(id);
    if (!record) throw new ScheduleNotFoundError(`Schedule ${id} not found`);
    return record;
  }

  /** Validates (ScheduleInvalidError with the field), gives the id from the title, computes nextRunAt when enabled. */
  async create(body: unknown): Promise<ScheduleRecord> {
    const now = this.clock.now();
    const input = this.valid(validateSchedule(body, this.options(now)));
    return this.locks.run(CREATE_LOCK, async () => {
      const id = proposeScheduleId(input.title, (await this.schedules.list()).map((s) => s.id));
      const stamp = now.toISOString();
      const record: ScheduleRecord = { ...input, id, nextRunAt: this.next(input, now), createdAt: stamp, updatedAt: stamp, results: [] };
      return this.locks.run(id, async () => {
        await this.schedules.save(record);
        return record;
      });
    });
  }

  /**
   * Replaces what the user wrote; id, createdAt and results stay. nextRunAt is computed again from now (null when disabled).
   * A one-off whose time has passed may be saved again only unchanged in time and disabled (e.g. a new title after it fired).
   */
  replace(id: string, body: unknown): Promise<ScheduleRecord> {
    return this.locks.run(id, async () => {
      const existing = await this.get(id);
      const now = this.clock.now();
      let checked = validateSchedule(body, this.options(now));
      if ('error' in checked && checked.error.field === 'when.at' && this.keepsPastOneOff(existing, body)) {
        // Check the rest as of just before that time.
        checked = validateSchedule(body, this.options(new Date(zonedToInstant(existing.when.at as string, this.zone).getTime() - 60_000)));
      }
      const input = this.valid(checked);
      const record: ScheduleRecord = {
        ...input, id, nextRunAt: this.next(input, now), createdAt: existing.createdAt, updatedAt: now.toISOString(), results: existing.results,
      };
      await this.schedules.save(record);
      return record;
    });
  }

  /** Removes the schedule and its results; the tasks it started stay. */
  delete(id: string): Promise<void> {
    return this.locks.run(id, async () => {
      if (!(await this.schedules.delete(id))) throw new ScheduleNotFoundError(`Schedule ${id} not found`);
    });
  }

  /** The next times of a `when` (ScheduleInvalidError with the field when it is invalid). */
  preview(when: unknown): SchedulePreview {
    const now = this.clock.now();
    const checked = validateWhen(when, { zone: this.zone, now });
    if ('error' in checked) throw new ScheduleInvalidError(checked.error.field, checked.error.message);
    return { zone: this.zone, next: previewNext(checked.value, this.zone, now, 3) };
  }

  private options(now: Date) {
    return { repositories: this.repositories.names(), zone: this.zone, now };
  }

  private valid(checked: ValidateResult): ScheduleInput {
    if ('error' in checked) throw new ScheduleInvalidError(checked.error.field, checked.error.message);
    return checked.value;
  }

  private next(input: ScheduleInput, now: Date): string | null {
    return input.enabled ? nextRunAt(input.when, this.zone, now) : null;
  }

  private keepsPastOneOff(existing: ScheduleRecord, body: unknown): boolean {
    if (existing.when.at === undefined || typeof body !== 'object' || body === null) return false;
    const { when, enabled } = body as { when?: { at?: unknown }; enabled?: unknown };
    return enabled === false && typeof when === 'object' && when !== null && when.at === existing.when.at;
  }
}
