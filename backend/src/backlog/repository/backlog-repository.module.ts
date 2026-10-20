import { Module } from '@nestjs/common';
import { BacklogConfigModule } from '../service/backlog-config.module';
import { BACKLOG_STORE } from '../service/backlog-store';
import { BacklogCacheRepository } from './backlog-cache.repository';

@Module({
  imports: [BacklogConfigModule],
  providers: [{ provide: BACKLOG_STORE, useClass: BacklogCacheRepository }],
  exports: [BACKLOG_STORE],
})
export class BacklogRepositoryModule {}
