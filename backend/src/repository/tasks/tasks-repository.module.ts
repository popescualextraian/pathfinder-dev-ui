import { Module } from '@nestjs/common';
import { ENGINE_CONFIG, EngineConfig, loadEngineConfig } from '../../commons/engine-config';
import { BRIDGE_CLIENT_FACTORY, createBridgeClient } from './bridge/bridge-client.factory';
import { TASK_LAUNCHER } from './launcher/task-launcher';
import { createTaskLauncher } from './launcher/task-launcher.factory';
import { TaskRecordRepository } from './task-record.repository';

@Module({
  providers: [
    { provide: ENGINE_CONFIG, useFactory: () => loadEngineConfig() },
    { provide: TASK_LAUNCHER, useFactory: (config: EngineConfig) => createTaskLauncher(config), inject: [ENGINE_CONFIG] },
    { provide: BRIDGE_CLIENT_FACTORY, useValue: createBridgeClient },
    TaskRecordRepository,
  ],
  exports: [ENGINE_CONFIG, TASK_LAUNCHER, BRIDGE_CLIENT_FACTORY, TaskRecordRepository],
})
export class TasksRepositoryModule {}
