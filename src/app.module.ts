import { Module } from '@nestjs/common';
import { SystemApiModule } from './api/system/system-api.module';

@Module({
  imports: [SystemApiModule],
})
export class AppModule {}
