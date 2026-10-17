import { Module } from '@nestjs/common';
import { ENGINE_CONFIG, loadEngineConfig } from './engine-config';

// Provides the validated engine config once; every module that needs it imports this module.
@Module({
  providers: [{ provide: ENGINE_CONFIG, useFactory: () => loadEngineConfig() }],
  exports: [ENGINE_CONFIG],
})
export class EngineConfigModule {}
