import { Module } from '@nestjs/common';
import { SystemServiceModule } from '../../service/system/system-service.module';
import { HealthController } from './health.controller';
import { SystemController } from './system.controller';

@Module({
  imports: [SystemServiceModule],
  controllers: [SystemController, HealthController],
})
export class SystemApiModule {}
