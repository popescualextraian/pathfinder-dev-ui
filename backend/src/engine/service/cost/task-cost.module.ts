import { Module } from '@nestjs/common';
import { TasksIntegrationModule } from '../../integration/tasks-integration.module';
import { TasksRepositoryModule } from '../../repository/tasks-repository.module';
import { TaskCostService } from './task-cost.service';

@Module({
  imports: [TasksIntegrationModule, TasksRepositoryModule],
  providers: [TaskCostService],
  exports: [TaskCostService],
})
export class TaskCostModule {}
