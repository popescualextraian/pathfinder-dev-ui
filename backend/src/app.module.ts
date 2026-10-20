import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { BacklogApiModule } from './api/backlog/backlog-api.module';
import { RepositoriesApiModule } from './api/repositories/repositories-api.module';
import { SystemApiModule } from './api/system/system-api.module';
import { TasksApiModule } from './api/tasks/tasks-api.module';
import { WorkflowsApiModule } from './api/workflows/workflows-api.module';
import { FRONTEND_DIR } from './commons/frontend-dir';
import { workflowsEnabled } from './commons/workflow-config';

// The backlog is optional: its API (and the polling behind it) exists only when BACKLOG_CONFIG is set.
export function backlogModules(env: NodeJS.ProcessEnv): Array<typeof BacklogApiModule> {
  return env.BACKLOG_CONFIG?.trim() ? [BacklogApiModule] : [];
}

// Workflows drive backlog items: their API (and the runner) exists only when BACKLOG_CONFIG and WORKFLOWS_DIR are both
// set; WORKFLOWS_DATA_DIR is then required. WORKFLOWS_DIR without BACKLOG_CONFIG is ignored (no routes, no error).
export function workflowModules(env: NodeJS.ProcessEnv): Array<typeof WorkflowsApiModule> {
  return workflowsEnabled(env) ? [WorkflowsApiModule] : [];
}

@Module({
  imports: [
    // Serves the built assets and index.html at /. Its own index.html fallback (renderPath) is switched off
    // by excluding every path: it cannot send files from a dot directory. SpaFallbackFilter does the fallback.
    ServeStaticModule.forRoot({ rootPath: FRONTEND_DIR, exclude: ['/{*path}'] }),
    SystemApiModule,
    RepositoriesApiModule,
    TasksApiModule,
    ...backlogModules(process.env),
    ...workflowModules(process.env),
  ],
})
export class AppModule {}
