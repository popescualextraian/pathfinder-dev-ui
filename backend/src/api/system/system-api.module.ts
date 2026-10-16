import { Module } from '@nestjs/common';
import { SystemServiceModule } from '../../service/system/system-service.module';
import { SystemController } from './system.controller';

@Module({
  imports: [SystemServiceModule],
  controllers: [SystemController],
})
export class SystemApiModule {}
