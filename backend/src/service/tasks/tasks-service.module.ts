import { Module } from '@nestjs/common';
import { EngineConfigModule } from '../../commons/engine-config.module';
import { TasksIntegrationModule } from '../../integration/tasks/tasks-integration.module';
import { TasksRepositoryModule } from '../../repository/tasks/tasks-repository.module';
import { TaskEventsService } from './task-events.service';
import { TaskPoller } from './task-poller';
import { TaskUpdates } from './task-updates';
import { TasksService } from './tasks.service';

@Module({
  imports: [EngineConfigModule, TasksIntegrationModule, TasksRepositoryModule],
  providers: [TasksService, TaskEventsService, TaskUpdates, TaskPoller],
  exports: [TasksService, TaskEventsService, TaskUpdates],
})
export class TasksServiceModule {}
