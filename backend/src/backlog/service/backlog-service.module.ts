import { Module } from '@nestjs/common';
import { BACKLOG_CONFIG, loadBacklogConfig } from './backlog-config';
import { BacklogPoller } from './backlog-poller';
import { BacklogTriggers } from './backlog-triggers';
import { BacklogUpdates } from './backlog-updates';
import { BacklogService } from './backlog.service';

// Expects BACKLOG_STORE (repository module) and BACKLOG_CONNECTOR (integration module) from the
// modules imported here once they exist (added by the repository and GitLab connector tasks).
@Module({
  imports: [],
  providers: [
    { provide: BACKLOG_CONFIG, useFactory: () => loadBacklogConfig() },
    BacklogService,
    BacklogUpdates,
    BacklogTriggers,
    BacklogPoller,
  ],
  exports: [BacklogService, BacklogUpdates, BacklogTriggers],
})
export class BacklogServiceModule {}
