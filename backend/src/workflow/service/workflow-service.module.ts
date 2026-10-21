import { DynamicModule, Module, ModuleMetadata } from '@nestjs/common';
import { WorkflowGenerator } from './generator/workflow-generator';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowRunUpdates } from './workflow-run-updates';
import { WorkflowRunner } from './workflow-runner';

export interface WorkflowServiceModuleOptions {
  /**
   * Modules that export the tokens the runner and the generator need: WORKFLOW_TASKS, WORK_ITEMS (adapters outside the
   * package), WORKFLOW_DEFINITION_REPOSITORY, WORKFLOW_RUN_REPOSITORY and WORKFLOW_GENERATION_REPOSITORY (e.g. the
   * package's file repositories, built from config).
   */
  imports: NonNullable<ModuleMetadata['imports']>;
}

// The workflow service layer. The app supplies what it needs through `register({ imports })`.
@Module({})
export class WorkflowServiceModule {
  static register(options: WorkflowServiceModuleOptions): DynamicModule {
    return {
      module: WorkflowServiceModule,
      imports: options.imports,
      providers: [WorkflowRunner, WorkflowRunUpdates, WorkflowDefinitionsService, WorkflowGenerator],
      exports: [WorkflowRunner, WorkflowRunUpdates, WorkflowDefinitionsService, WorkflowGenerator],
    };
  }
}
