import { Module } from '@nestjs/common';
import { ENGINE_CONFIG, EngineConfig } from '../../commons/engine-config';
import { EngineConfigModule } from '../../commons/engine-config.module';
import { SCHEDULE_CONFIG, ScheduleConfig } from '../../commons/schedule-config';
import { ScheduleConfigModule } from '../../commons/schedule-config.module';
import { TasksServiceModule } from '../../engine';
import { SCHEDULE_REPOSITORIES, SCHEDULE_REPOSITORY, SCHEDULED_TASKS, ScheduleFileRepository, ScheduleRepositories } from '../../schedule';
import { EngineScheduledTasks } from './engine-scheduled-tasks';

// What the scheduler needs from the rest of the app (passed to ScheduleServiceModule.register): the engine adapter, the
// configured repository names, the package's file repository bound to SCHEDULES_DATA_DIR, and the schedule config.
@Module({
  imports: [TasksServiceModule, EngineConfigModule, ScheduleConfigModule],
  providers: [
    { provide: SCHEDULED_TASKS, useClass: EngineScheduledTasks },
    {
      provide: SCHEDULE_REPOSITORIES,
      useFactory: (config: EngineConfig): ScheduleRepositories => ({ names: () => config.repositories.map((r) => r.name) }),
      inject: [ENGINE_CONFIG],
    },
    {
      provide: SCHEDULE_REPOSITORY,
      useFactory: (config: ScheduleConfig) => new ScheduleFileRepository(config.dataDir),
      inject: [SCHEDULE_CONFIG],
    },
  ],
  exports: [SCHEDULED_TASKS, SCHEDULE_REPOSITORIES, SCHEDULE_REPOSITORY, ScheduleConfigModule],
})
export class ScheduleIntegrationModule {}
