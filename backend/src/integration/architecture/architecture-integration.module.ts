import { Module } from '@nestjs/common';
import { ARCHITECTURE_CONFIG, ArchitectureConfig } from '../../commons/architecture-config';
import { ArchitectureConfigModule } from '../../commons/architecture-config.module';
import { ENGINE_CONFIG, EngineConfig } from '../../commons/engine-config';
import { EngineConfigModule } from '../../commons/engine-config.module';
import { REPOSITORY_FILES, RepositoryFiles } from '../../service/architecture/repository-files';
import { GitRepositoryFiles } from './git-repository-files';

// The git-backed RepositoryFiles over the engine's configured repositories, cloned into ARCHITECTURE_DATA_DIR.
@Module({
  imports: [EngineConfigModule, ArchitectureConfigModule],
  providers: [
    {
      provide: REPOSITORY_FILES,
      useFactory: (engine: EngineConfig, architecture: ArchitectureConfig): RepositoryFiles =>
        new GitRepositoryFiles({
          dataDir: architecture.dataDir,
          fetchSeconds: architecture.fetchSeconds,
          repositories: engine.repositories.map(({ name, url }) => ({ name, url })),
        }),
      inject: [ENGINE_CONFIG, ARCHITECTURE_CONFIG],
    },
  ],
  exports: [REPOSITORY_FILES],
})
export class ArchitectureIntegrationModule {}
