// Public surface of the backlog component.
export { BacklogServiceModule } from './service/backlog-service.module';
export { BacklogService } from './service/backlog.service';
export { BacklogUpdates } from './service/backlog-updates';
export type { BacklogChange } from './service/backlog-updates';
export { BacklogTriggers } from './service/backlog-triggers';
export type { TriggerEvent } from './service/backlog-triggers';
export { BacklogConflictError, BacklogNotFoundError, BacklogUnreachableError, safeMessage } from './service/backlog-errors';
export { BacklogConfigError, loadBacklogConfig } from './service/backlog-config';
export type { FileLink, Item } from './service/backlog-connector';
