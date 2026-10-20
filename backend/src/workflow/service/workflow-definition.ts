export type Gate = 'human' | 'auto';

export interface SessionDef {
  name: string;
  prompt: string;
  /** An earlier session's name: start as a copy of that conversation. */
  fork?: string;
  model?: string;
}

export interface StepDef {
  id: string;
  title: string;
  /** Work item stage the item moves to when the step starts (backlog: lane id); without it the item stays. */
  stage?: string;
  sessions: SessionDef[];
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
