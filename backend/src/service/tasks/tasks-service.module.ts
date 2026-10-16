import { Module } from '@nestjs/common';
import { TasksRepositoryModule } from '../../repository/tasks/tasks-repository.module';
import { TaskEventsService } from './task-events.service';
import { TasksService } from './tasks.service';

@Module({
  imports: [TasksRepositoryModule],
  providers: [TasksService, TaskEventsService],
  exports: [TasksService, TaskEventsService],
})
export class TasksServiceModule {}
