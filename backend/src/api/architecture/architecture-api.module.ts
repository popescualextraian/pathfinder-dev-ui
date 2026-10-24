import { Module } from '@nestjs/common';
import { ArchitectureServiceModule } from '../../service/architecture/architecture-service.module';
import { ArchitectureController } from './architecture.controller';

@Module({
  imports: [ArchitectureServiceModule],
  controllers: [ArchitectureController],
})
export class ArchitectureApiModule {}
