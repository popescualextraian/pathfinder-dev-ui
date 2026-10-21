import { Module } from '@nestjs/common';
import { loadScheduleConfig, SCHEDULE_CONFIG } from './schedule-config';

// Provides the validated schedule config once (SCHEDULES_DATA_DIR, SCHEDULES_TIMEZONE, SCHEDULES_TICK_SECONDS); a bad
// value stops the startup with an error naming the variable.
@Module({
  providers: [{ provide: SCHEDULE_CONFIG, useFactory: () => loadScheduleConfig() }],
  exports: [SCHEDULE_CONFIG],
})
export class ScheduleConfigModule {}
