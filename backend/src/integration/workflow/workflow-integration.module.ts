import { Module } from '@nestjs/common';
import { join } from 'node:path';
import { BacklogServiceModule } from '../../backlog';
import { WORKFLOW_CONFIG, WorkflowConfig } from '../../commons/workflow-config';
import { WorkflowConfigModule } from '../../commons/workflow-config.module';
import { TasksServiceModule } from '../../engine';
import {
  WORK_ITEMS, WORKFLOW_DEFINITION_REPOSITORY, WORKFLOW_GENERATION_REPOSITORY, WORKFLOW_RUN_REPOSITORY, WORKFLOW_TASKS,
  WorkflowDefinitionFileRepository, WorkflowGenerationFileRepository, WorkflowRunFileRepository, WorkItems,
} from '../../workflow';
import { BacklogWorkItems } from './backlog-work-items';
import { EngineWorkflowTasks } from './engine-workflow-tasks';

// What the workflow runner and generator need from the rest of the app (passed to WorkflowServiceModule.register): the engine and
// backlog adapters, and the package's file repositories (definitions, runs, generations) bound to the configured directories. The definition repository
// sits here too because it validates stages against the work items (backlog lane ids).
@Module({
  imports: [TasksServiceModule, BacklogServiceModule, WorkflowConfigModule],
  providers: [
    { provide: WORKFLOW_TASKS, useClass: EngineWorkflowTasks },
    { provide: WORK_ITEMS, useClass: BacklogWorkItems },
    {
      provide: WORKFLOW_DEFINITION_REPOSITORY,
      useFactory: (config: WorkflowConfig, items: WorkItems) => new WorkflowDefinitionFileRepository(config.dir, items),
      inject: [WORKFLOW_CONFIG, WORK_ITEMS],
    },
    {
      provide: WORKFLOW_RUN_REPOSITORY,
      useFactory: (config: WorkflowConfig) => new WorkflowRunFileRepository(config.dataDir),
      inject: [WORKFLOW_CONFIG],
    },
    {
      // Generations sit in their own folder of the data dir, next to the run files.
      provide: WORKFLOW_GENERATION_REPOSITORY,
      useFactory: (config: WorkflowConfig) => new WorkflowGenerationFileRepository(join(config.dataDir, 'generations')),
      inject: [WORKFLOW_CONFIG],
    },
  ],
  exports: [WORKFLOW_TASKS, WORK_ITEMS, WORKFLOW_DEFINITION_REPOSITORY, WORKFLOW_RUN_REPOSITORY, WORKFLOW_GENERATION_REPOSITORY],
})
export class WorkflowIntegrationModule {}
