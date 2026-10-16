import { Module } from '@nestjs/common';
import { SystemRepositoryModule } from '../../repository/system/system-repository.module';
import { SystemService } from './system.service';

@Module({
  imports: [SystemRepositoryModule],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemServiceModule {}
