import type { ScheduleRecord } from './schedule';

export const SCHEDULE_REPOSITORY = Symbol('SCHEDULE_REPOSITORY');

export interface ScheduleRepository {
  /** All schedules, oldest first. */
  list(): Promise<ScheduleRecord[]>;
  get(id: string): Promise<ScheduleRecord | undefined>;
  /** Creates or replaces; keeps only the newest results. */
  save(record: ScheduleRecord): Promise<void>;
  /** True when it existed. */
  delete(id: string): Promise<boolean>;
}
