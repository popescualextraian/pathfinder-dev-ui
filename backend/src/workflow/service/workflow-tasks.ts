/** States of a task and of its sessions, as the engine reports them. */
export type WorkflowTaskState =
  | 'starting' | 'running' | 'waiting' | 'idle' | 'suspended' | 'stopped' | 'failed' | 'interrupted';

export interface WorkflowSessionSnapshot {
  name: string;
  state: WorkflowTaskState;
  openQuestions: number;
  /** Time of the session's last final agent message, if any. */
  lastMessageAt?: string;
}

export interface WorkflowTaskSnapshot {
  id: string;
  state: WorkflowTaskState;
  /** The task's git branch, when known. */
  branch?: string;
  sessions: WorkflowSessionSnapshot[];
  /** Set when the task failed. */
  failureReason?: string;
}

export interface WorkflowTaskStart {
  title: string;
  prompt: string;
  model?: string;
  /** What the task is for; the engine records and shows it. */
  kind?: 'workflow-generator';
}

export interface WorkflowSessionStart {
  name: string;
  prompt: string;
  fork?: string;
  model?: string;
}

/** Minimal observable of task ids that changed (an rxjs Observable<string> fits). */
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
  /** Path (relative to the task's worktree) -> whether it exists. */
  hasFiles(taskId: string, paths: string[]): Promise<Record<string, boolean>>;
  /** Text of a file in the task's worktree, null when missing; throws when over 64 KB. */
  readFile(taskId: string, path: string): Promise<string | null>;
  readonly changes: TaskChanges;
}

export const WORKFLOW_TASKS = Symbol('WORKFLOW_TASKS');
