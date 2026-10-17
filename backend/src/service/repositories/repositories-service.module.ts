import { Module } from '@nestjs/common';
import { EngineConfigModule } from '../../commons/engine-config.module';
import { RepositoriesService } from './repositories.service';

@Module({
  imports: [EngineConfigModule],
  providers: [RepositoriesService],
  exports: [RepositoriesService],
})
export class RepositoriesServiceModule {}
