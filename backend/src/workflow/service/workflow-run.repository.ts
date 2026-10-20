import type { WorkflowRun } from './workflow-run';

export interface WorkflowRunRepository {
  /** All runs, oldest first. */
  list(): Promise<WorkflowRun[]>;
  get(id: string): Promise<WorkflowRun | undefined>;
  /** Creates or replaces the run. */
  save(run: WorkflowRun): Promise<void>;
}

export const WORKFLOW_RUN_REPOSITORY = Symbol('WORKFLOW_RUN_REPOSITORY');
