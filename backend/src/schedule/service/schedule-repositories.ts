// The configured repository names a schedule may name; the schedule package does not know where they come from.
export const SCHEDULE_REPOSITORIES = Symbol('SCHEDULE_REPOSITORIES');

export interface ScheduleRepositories {
  names(): readonly string[];
}
