// The task engine's public surface: code outside src/engine imports only from here.
// The engine itself depends on nothing in the backend but commons (enforced by engine-boundary.spec.ts).
export { TasksServiceModule } from './service/tasks-service.module';
export { TasksService } from './service/tasks.service';
export { MAX_RUN_TIMEOUT_SECONDS, MIN_RUN_TIMEOUT_SECONDS } from './service/tasks.service';
export type { TaskView, AddSessionInput, StartTaskInput } from './service/tasks.service';
export type { TaskFileName } from './service/task-launcher';
export type { TaskChange } from './service/task-updates';
export type { SessionView, ViewQuestion } from './service/task-view';
export { TaskEventsService } from './service/task-events.service';
export { TaskUpdates } from './service/task-updates';
export { BridgeError, BridgeUnreachableError } from './service/bridge-client';
export { WorktreeFileTooLargeError } from './service/task-launcher';
export type { BridgeEvent as TaskEvent } from './service/bridge-client';
