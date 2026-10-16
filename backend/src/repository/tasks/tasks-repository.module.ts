import { Module } from '@nestjs/common';
import { ENGINE_CONFIG, EngineConfig, loadEngineConfig } from '../../commons/engine-config';
import { TASK_LAUNCHER } from './launcher/task-launcher';
import { createTaskLauncher } from './launcher/task-launcher.factory';
import { TaskRecordRepository } from './task-record.repository';

@Module({
  providers: [
    { provide: ENGINE_CONFIG, useFactory: () => loadEngineConfig() },
    { provide: TASK_LAUNCHER, useFactory: (config: EngineConfig) => createTaskLauncher(config), inject: [ENGINE_CONFIG] },
    TaskRecordRepository,
  ],
  exports: [ENGINE_CONFIG, TASK_LAUNCHER, TaskRecordRepository],
})
export class TasksRepositoryModule {}
