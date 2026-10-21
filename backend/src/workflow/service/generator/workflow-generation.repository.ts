import type { WorkflowGeneration } from './workflow-generation';

export interface WorkflowGenerationRepository {
  /** All generations, oldest first. */
  list(): Promise<WorkflowGeneration[]>;
  get(id: string): Promise<WorkflowGeneration | undefined>;
  /** Creates or replaces the generation. */
  save(generation: WorkflowGeneration): Promise<void>;
  /** Removes it; nothing happens when it is gone. */
  delete(id: string): Promise<void>;
}

export const WORKFLOW_GENERATION_REPOSITORY = Symbol('WORKFLOW_GENERATION_REPOSITORY');
