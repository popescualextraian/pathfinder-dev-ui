import type { WorkflowDefinition, WorkflowDefinitions } from './workflow-definition';

/** A definition with the version of the stored file (a hash of its content): the token of optimistic updates. */
export interface StoredWorkflow {
  definition: WorkflowDefinition;
  version: string;
}

export interface WorkflowDefinitionRepository {
  /** Re-reads the source on every call. Bad files are listed in `refused` (with the `version` of their content), the rest still load. */
  list(): Promise<WorkflowDefinitions>;
  get(id: string): Promise<WorkflowDefinition | undefined>;
  /** The definition and its version. WorkflowNotFoundError when there is none (a refused file is not a definition). */
  read(id: string): Promise<StoredWorkflow>;
  /**
   * Validates, then writes the definition (the first rule broken is thrown as WorkflowDefinitionError; a bad id as
   * WorkflowInvalidError). Without `expectedVersion`: create, WorkflowConflictError when the id exists. With it: update,
   * WorkflowNotFoundError when the id is gone, WorkflowConflictError when the file changed since. Throws
   * WorkflowReadOnlyError when the folder is not writable. Returns what was written, with its new version.
   */
  save(id: string, definition: WorkflowDefinition, expectedVersion?: string): Promise<StoredWorkflow>;
  /** Deletes the file of the definition: NotFound when gone, Conflict when changed since `expectedVersion`, ReadOnly. */
  delete(id: string, expectedVersion: string): Promise<void>;
  /** Deletes a refused file by its file name from `list().refused` (anything else is NotFound); same errors as delete. */
  deleteRefused(file: string, expectedVersion: string): Promise<void>;
  /** Whether the folder accepts writes. */
  writable(): Promise<boolean>;
}

export const WORKFLOW_DEFINITION_REPOSITORY = Symbol('WORKFLOW_DEFINITION_REPOSITORY');
