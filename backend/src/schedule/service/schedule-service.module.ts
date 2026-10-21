import { DynamicModule, Module, ModuleMetadata } from '@nestjs/common';
import { ScheduleLocks } from './schedule-locks';
import { ScheduleRunner } from './schedule-runner';
import { ScheduleService } from './schedule.service';

export interface ScheduleServiceModuleOptions {
  /**
   * Modules that export the tokens the scheduler needs: SCHEDULED_TASKS (adapter on the engine, outside the package),
   * SCHEDULE_REPOSITORY (e.g. the package's file repository), SCHEDULE_REPOSITORIES (the configured repository names)
   * and SCHEDULE_CONFIG (commons). SCHEDULE_CLOCK is optional (default: the system clock).
   */
  imports: NonNullable<ModuleMetadata['imports']>;
}

// The schedule service layer. The app supplies what it needs through `register({ imports })`.
@Module({})
export class ScheduleServiceModule {
  static register(options: ScheduleServiceModuleOptions): DynamicModule {
    return {
      module: ScheduleServiceModule,
      imports: options.imports,
      providers: [ScheduleLocks, ScheduleRunner, ScheduleService],
      exports: [ScheduleRunner, ScheduleService],
    };
  }
}
