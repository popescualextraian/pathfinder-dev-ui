import { Module } from '@nestjs/common';
import { BacklogIntegrationModule } from '../integration/backlog-integration.module';
import { BacklogRepositoryModule } from '../repository/backlog-repository.module';
import { BacklogConfigModule } from './backlog-config.module';
import { BacklogPoller } from './backlog-poller';
import { BacklogTriggers } from './backlog-triggers';
import { BacklogUpdates } from './backlog-updates';
import { BacklogService } from './backlog.service';

// Only this module imports the integration module to wire the connector implementation.
@Module({
  imports: [BacklogConfigModule, BacklogRepositoryModule, BacklogIntegrationModule],
  providers: [
    BacklogService,
    BacklogUpdates,
    BacklogTriggers,
    BacklogPoller,
  ],
  exports: [BacklogService, BacklogUpdates, BacklogTriggers],
})
export class BacklogServiceModule {}
