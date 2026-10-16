import { Module } from '@nestjs/common';
import { TasksServiceModule } from '../../service/tasks/tasks-service.module';
import { TasksController } from './tasks.controller';

@Module({
  imports: [TasksServiceModule],
  controllers: [TasksController],
})
export class TasksApiModule {}
