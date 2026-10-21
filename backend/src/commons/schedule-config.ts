import { dirname, isAbsolute, join } from 'node:path';

// Injection token of the validated schedule configuration.
export const SCHEDULE_CONFIG = Symbol('SCHEDULE_CONFIG');

export interface ScheduleConfig {
  // SCHEDULES_DATA_DIR: one JSON file per schedule (default: `schedules` next to ENGINE_DATA_DIR).
  dataDir: string;
  // SCHEDULES_TIMEZONE: IANA zone of cron lines and `at` times (default: the process zone).
  timezone: string;
  // SCHEDULES_TICK_SECONDS: how often the scheduler looks for due schedules (1..3600).
  tickSeconds: number;
}

// Messages name variables only, never their values.
export class ScheduleConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid schedule configuration: ${problems.join('; ')}`);
    this.name = 'ScheduleConfigError';
  }
}

const MAX_TICK_SECONDS = 3600;

const value = (env: NodeJS.ProcessEnv, name: string): string | undefined => env[name]?.trim() || undefined;

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Schedules are always on; every setting has a default.
export function loadScheduleConfig(env: NodeJS.ProcessEnv = process.env): ScheduleConfig {
  const problems: string[] = [];

  let dataDir = value(env, 'SCHEDULES_DATA_DIR');
  const engineDir = value(env, 'ENGINE_DATA_DIR');
  if (dataDir === undefined) {
    if (engineDir === undefined) problems.push('SCHEDULES_DATA_DIR is required when ENGINE_DATA_DIR is not set');
    else if (isAbsolute(engineDir)) dataDir = join(dirname(engineDir), 'schedules');
  } else if (!isAbsolute(dataDir)) {
    problems.push('SCHEDULES_DATA_DIR must be an absolute path');
  }

  let timezone = value(env, 'SCHEDULES_TIMEZONE');
  if (timezone === undefined) timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  else if (!validZone(timezone)) problems.push('SCHEDULES_TIMEZONE must be an IANA time zone');

  let tickSeconds = 30;
  const rawTick = value(env, 'SCHEDULES_TICK_SECONDS');
  if (rawTick !== undefined) {
    if (!/^[1-9]\d*$/.test(rawTick)) problems.push('SCHEDULES_TICK_SECONDS must be a positive integer');
    else if (Number(rawTick) > MAX_TICK_SECONDS) problems.push(`SCHEDULES_TICK_SECONDS must be at most ${MAX_TICK_SECONDS}`);
    else tickSeconds = Number(rawTick);
  }

  if (problems.length > 0) throw new ScheduleConfigError(problems);
  return { dataDir: dataDir ?? '', timezone, tickSeconds };
}
