import { loadScheduleConfig, ScheduleConfigError } from '../../../src/commons/schedule-config';

const base = { ENGINE_DATA_DIR: '/data/tasks' };

describe('loadScheduleConfig', () => {
  it('defaults: sibling of ENGINE_DATA_DIR, process zone, 30 s', () => {
    const config = loadScheduleConfig(base);
    expect(config.dataDir).toBe('/data/schedules');
    expect(config.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(config.tickSeconds).toBe(30);
  });

  it('reads explicit values', () => {
    expect(loadScheduleConfig({ SCHEDULES_DATA_DIR: '/x/s', SCHEDULES_TIMEZONE: 'Europe/Bucharest', SCHEDULES_TICK_SECONDS: '5' }))
      .toEqual({ dataDir: '/x/s', timezone: 'Europe/Bucharest', tickSeconds: 5 });
  });

  it.each([
    [{ ...base, SCHEDULES_DATA_DIR: 'rel/dir' }, 'SCHEDULES_DATA_DIR must be an absolute path'],
    [{ ...base, SCHEDULES_TIMEZONE: 'Mars/Base' }, 'SCHEDULES_TIMEZONE must be an IANA time zone'],
    [{ ...base, SCHEDULES_TICK_SECONDS: '0' }, 'SCHEDULES_TICK_SECONDS must be a positive integer'],
    [{ ...base, SCHEDULES_TICK_SECONDS: '1.5' }, 'SCHEDULES_TICK_SECONDS must be a positive integer'],
    [{ ...base, SCHEDULES_TICK_SECONDS: 'abc' }, 'SCHEDULES_TICK_SECONDS must be a positive integer'],
    [{}, 'SCHEDULES_DATA_DIR is required when ENGINE_DATA_DIR is not set'],
  ])('refuses %j', (env, message) => {
    expect(() => loadScheduleConfig(env)).toThrow(ScheduleConfigError);
    expect(() => loadScheduleConfig(env)).toThrow(message);
  });
});
