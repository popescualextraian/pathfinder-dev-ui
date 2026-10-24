import { Module } from '@nestjs/common';
import { ARCHITECTURE_CONFIG, loadArchitectureConfig } from './architecture-config';

// Provides the validated architecture config once; a bad value stops the startup with an error naming the variable.
@Module({
  providers: [{ provide: ARCHITECTURE_CONFIG, useFactory: () => loadArchitectureConfig() }],
  exports: [ARCHITECTURE_CONFIG],
})
export class ArchitectureConfigModule {}
