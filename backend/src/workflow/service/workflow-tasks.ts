export type WorkflowTaskState = 'running' | 'idle' | 'stopped' | 'failed' | string;

export interface WorkflowSessionSnapshot {
  name: string;
  state: string;
  openQuestions: number;
}

export interface WorkflowTaskSnapshot {
  id: string;
  state: WorkflowTaskState;
  sessions: WorkflowSessionSnapshot[];
  /** Set when the task failed. */
  failureReason?: string;
}

export interface WorkflowTaskStart {
  title: string;
  prompt: string;
  model?: string;
}

export interface WorkflowSessionStart {
  name: string;
  prompt: string;
  fork?: string;
  model?: string;
}

/** Minimal observable of task ids that changed (no rxjs dependency in the package). */
export interface TaskChanges {
  subscribe(listener: (taskId: string) => void): { unsubscribe(): void };
}

/** What the workflow package needs from the task engine (implemented outside the package). */
export interface WorkflowTasks {
  start(input: WorkflowTaskStart): Promise<string>;
  addSession(taskId: string, session: WorkflowSessionStart): Promise<void>;
  prompt(taskId: string, session: string, text: string): Promise<void>;
  /** Resolves undefined or null for a task that vanished. */
  get(taskId: string): Promise<WorkflowTaskSnapshot | undefined | null>;
  hasFiles(taskId: string, paths: string[]): Promise<Record<string, boolean> | string[]>;
  readonly changes: TaskChanges;
}
