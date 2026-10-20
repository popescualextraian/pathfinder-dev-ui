import { Module } from '@nestjs/common';
import { loadWorkflowConfig, WORKFLOW_CONFIG } from './workflow-config';

// Provides the validated workflow config once (WORKFLOWS_DIR, WORKFLOWS_DATA_DIR). Only imported when workflows are on;
// a missing or relative directory then stops the startup with an error naming the variable.
@Module({
  providers: [{ provide: WORKFLOW_CONFIG, useFactory: () => loadWorkflowConfig() }],
  exports: [WORKFLOW_CONFIG],
})
export class WorkflowConfigModule {}
