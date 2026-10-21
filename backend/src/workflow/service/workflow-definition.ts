export type Gate = 'human' | 'auto';

export interface StepDef {
  id: string;
  title: string;
  /** Work item stage the item moves to when the step starts (backlog: lane id); without it the item stays. */
  stage?: string;
  prompt: string;
  model?: string;
  /** Id of an earlier step: this step goes on in that step's conversation (its prompt is sent to the same session). */
  continue?: string;
  /** Id of an earlier step: this step starts as a copy of that step's conversation. */
  fork?: string;
  /**
   * Internal, only in the definition snapshot of a run saved before one-session steps: the session name the step
   * used. Takes precedence over the name derived from the step. Never read from or written to workflow files.
   */
  session?: string;
  gate: Gate;
  /** Paths relative to the worktree, may contain placeholders. */
  requires?: string[];
  exitPrompt?: string;
}

export interface WorkflowDefinition {
  /** File name without extension. */
  id: string;
  title: string;
  steps: StepDef[];
  doneStage?: string;
}

export interface RefusedWorkflow {
  file: string;
  error: string;
  /** Version of the file content (for deleting it); absent when the file could not be read. */
  version?: string;
}

export interface WorkflowDefinitions {
  definitions: WorkflowDefinition[];
  refused: RefusedWorkflow[];
}
