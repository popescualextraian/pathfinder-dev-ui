import { Module } from '@nestjs/common';
import { EngineConfigModule } from '../../commons/engine-config.module';
import { TaskRecordRepository } from './task-record.repository';

@Module({
  imports: [EngineConfigModule],
  providers: [TaskRecordRepository],
  exports: [TaskRecordRepository],
})
export class TasksRepositoryModule {}
