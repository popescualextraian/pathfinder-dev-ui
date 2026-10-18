import { Module } from '@nestjs/common';
import { TasksServiceModule } from '../../engine';
import { TasksController } from './tasks.controller';

@Module({
  imports: [TasksServiceModule],
  controllers: [TasksController],
})
export class TasksApiModule {}
