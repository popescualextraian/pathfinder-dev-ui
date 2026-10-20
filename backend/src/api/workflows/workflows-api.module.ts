import { Module } from '@nestjs/common';
import { WorkflowIntegrationModule } from '../../integration/workflow/workflow-integration.module';
import { WorkflowServiceModule } from '../../workflow';
import { WorkflowRunsController } from './workflow-runs.controller';
import { WorkflowsController } from './workflows.controller';

// Loaded only when workflows are on (BACKLOG_CONFIG and WORKFLOWS_DIR set; see workflowModules in app.module.ts).
@Module({
  imports: [WorkflowServiceModule.register({ imports: [WorkflowIntegrationModule] })],
  controllers: [WorkflowsController, WorkflowRunsController],
})
export class WorkflowsApiModule {}
