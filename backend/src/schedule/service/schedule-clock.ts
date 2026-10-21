// The scheduler's clock, injectable so tests can move time.
export interface ScheduleClock {
  now(): Date;
}

export const SCHEDULE_CLOCK = Symbol('SCHEDULE_CLOCK');

export const SYSTEM_CLOCK: ScheduleClock = { now: () => new Date() };
