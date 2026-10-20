import { Module } from '@nestjs/common';
import { BACKLOG_CONFIG, BacklogConfig } from '../service/backlog-config';
import { BacklogConfigModule } from '../service/backlog-config.module';
import { BACKLOG_CONNECTOR } from '../service/backlog-connector';
import { createConnector } from './connector.factory';

@Module({
  imports: [BacklogConfigModule],
  providers: [{ provide: BACKLOG_CONNECTOR, useFactory: (config: BacklogConfig) => createConnector(config), inject: [BACKLOG_CONFIG] }],
  exports: [BACKLOG_CONNECTOR],
})
export class BacklogIntegrationModule {}
