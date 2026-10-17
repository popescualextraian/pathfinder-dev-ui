import { Module } from '@nestjs/common';
import { ENGINE_CONFIG, EngineConfig } from '../../commons/engine-config';
import { EngineConfigModule } from '../../commons/engine-config.module';
import { BRIDGE_CLIENT_FACTORY } from '../../service/tasks/bridge-client';
import { TASK_LAUNCHER } from '../../service/tasks/task-launcher';
import { createBridgeClient } from './bridge/bridge-client.factory';
import { createTaskLauncher } from './launcher/task-launcher.factory';

@Module({
  imports: [EngineConfigModule],
  providers: [
    { provide: TASK_LAUNCHER, useFactory: (config: EngineConfig) => createTaskLauncher(config), inject: [ENGINE_CONFIG] },
    { provide: BRIDGE_CLIENT_FACTORY, useValue: createBridgeClient },
  ],
  exports: [TASK_LAUNCHER, BRIDGE_CLIENT_FACTORY],
})
export class TasksIntegrationModule {}
