import { Module } from '@nestjs/common';
import { ArchitectureIntegrationModule } from '../../integration/architecture/architecture-integration.module';
import { RepositoriesServiceModule } from '../repositories/repositories-service.module';
import { ArchitectureService } from './architecture.service';

@Module({
  imports: [RepositoriesServiceModule, ArchitectureIntegrationModule],
  providers: [ArchitectureService],
  exports: [ArchitectureService],
})
export class ArchitectureServiceModule {}
