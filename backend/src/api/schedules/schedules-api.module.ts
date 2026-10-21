import { Module } from '@nestjs/common';
import { ScheduleIntegrationModule } from '../../integration/schedule/schedule-integration.module';
import { ScheduleServiceModule } from '../../schedule';
import { SchedulesController } from './schedules.controller';

// Schedules are always on (see app.module.ts). The runner starts its timer on module init and stops it on destroy.
@Module({
  imports: [ScheduleServiceModule.register({ imports: [ScheduleIntegrationModule] })],
  controllers: [SchedulesController],
})
export class SchedulesApiModule {}
