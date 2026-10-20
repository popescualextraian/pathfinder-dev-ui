import type { WorkflowDefinition, WorkflowDefinitions } from './workflow-definition';

export interface WorkflowDefinitionRepository {
  /** Re-reads the source on every call. Bad files are listed in `refused`, the rest still load. */
  list(): Promise<WorkflowDefinitions>;
  get(id: string): Promise<WorkflowDefinition | undefined>;
}

export const WORKFLOW_DEFINITION_REPOSITORY = Symbol('WORKFLOW_DEFINITION_REPOSITORY');
