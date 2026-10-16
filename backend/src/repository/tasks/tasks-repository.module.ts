import { Module } from '@nestjs/common';
import { ENGINE_CONFIG, loadEngineConfig } from '../../commons/engine-config';
import { TaskRecordRepository } from './task-record.repository';

@Module({
  providers: [{ provide: ENGINE_CONFIG, useFactory: () => loadEngineConfig() }, TaskRecordRepository],
  exports: [ENGINE_CONFIG, TaskRecordRepository],
})
export class TasksRepositoryModule {}
