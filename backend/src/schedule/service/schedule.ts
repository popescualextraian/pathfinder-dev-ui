// The schedule model. Times are ISO strings; `when.at` is a local time ('YYYY-MM-DDTHH:mm') in SCHEDULES_TIMEZONE.
export type When = { cron: string; at?: undefined } | { at: string; cron?: undefined };

export type ScheduleTrigger = 'time' | 'manual';
export type ScheduleOutcome = 'running' | 'done' | 'timeout' | 'failed' | 'skipped' | 'missed' | 'refused';

/** One firing of a schedule. */
export interface ScheduleResult {
  firedAt: string;
  trigger: ScheduleTrigger;
  outcome: ScheduleOutcome;
  reason?: string;
  taskId?: string;
  branch?: string;
  summary?: string;
  endedAt?: string;
}

/** What a user writes (create/replace); everything else is set by the service. */
export interface ScheduleInput {
  title: string;
  prompt: string;
  repository: string;
  ref?: string;
  model?: string;
  when: When;
  timeoutMinutes: number;
  enabled: boolean;
}

export interface Schedule extends ScheduleInput {
  id: string;
  /** Next firing (ISO with the zone offset); null when disabled or finished. */
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A schedule as stored: with its results, newest first. */
export interface ScheduleRecord extends Schedule {
  results: ScheduleResult[];
}

export const DEFAULT_TIMEOUT_MINUTES = 120;
export const MIN_TIMEOUT_MINUTES = 1;
export const MAX_TIMEOUT_MINUTES = 1440;
