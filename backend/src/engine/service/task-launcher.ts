import type { TaskFileName } from './worktree-paths';
// Injection token of the TaskLauncher in use (picked from config by the factory).
export const TASK_LAUNCHER = Symbol('TASK_LAUNCHER');

// The grants every task starts with (AGENTIC_ALLOWED_ACTIONS): the gate still blocks merges and protected words;
// `deploy` is left out because it needs a named target.
export const TASK_GRANTS = 'push,open-pr';

// What the service knows about a task. Secrets and project settings come from the engine config.
export interface LaunchSpec {
  taskId: string;
  taskToken: string;
  agentToken: string;
  prompt: string;
  repoUrl: string;
  repoRef?: string;
  model?: string;
  branch: string;
  // A scheduled run: the bridge ends the task itself after its summary or at the timeout (AGENTIC_SCHEDULED, AGENTIC_RUN_TIMEOUT).
  scheduled?: { runTimeoutSeconds: number };
}

export interface LaunchResult {
  bridgeUrl: string;
}

export interface TaskInspection {
  exists: boolean;
  running: boolean;
  bridgeUrl: string;
}

// The ledger is read whole into memory: anything larger is treated as unreadable.
export const LEDGER_MAX_BYTES = 8 * 1024 * 1024;

// Cap for readFile of a worktree file (the UI only reads small text files such as workflow-draft.yaml).
export const WORKTREE_FILE_MAX_BYTES = 64 * 1024;

// Cap for readTaskFile (result.md, state.json).
export const TASK_FILE_MAX_BYTES = 64 * 1024;
export type { TaskFileName } from './worktree-paths';

/** readFile of a worktree file larger than its cap (the message names the path, the task and the cap). */
export class WorktreeFileTooLargeError extends Error {
  constructor(path: string, taskId: string, readonly maxBytes: number) {
    super(`File ${JSON.stringify(path)} of task ${taskId} is over ${maxBytes} bytes`);
    this.name = 'WorktreeFileTooLargeError';
  }
}

export interface TaskLauncher {
  // Creates and starts the task's container (and volume).
  launch(spec: LaunchSpec): Promise<LaunchResult>;
  // Starts an existing, stopped container.
  start(taskId: string): Promise<void>;
  stop(taskId: string): Promise<void>;
  // Removes container and volume; does nothing when they are gone.
  remove(taskId: string): Promise<void>;
  inspect(taskId: string): Promise<TaskInspection>;
  // Number of running task containers, for the ENGINE_MAX_RUNNING cap.
  countRunning(): Promise<number>;
  // Raw text of the task's cost ledger (ledger.jsonl in the task dir); works on a stopped task.
  // undefined when it is missing or larger than LEDGER_MAX_BYTES.
  readLedger(taskId: string): Promise<string | undefined>;
  // Text of result.md or state.json in the task's own /task folder, or null when missing (also when the container or folder is gone).
  // Works on a stopped task. Refuses any other name (BadRequestException); throws WorktreeFileTooLargeError over TASK_FILE_MAX_BYTES.
  readTaskFile(taskId: string, name: TaskFileName): Promise<string | null>;
  // Whether each path (relative to the task's worktree, where the agent works: /work/.worktrees/<task id>) exists, file or directory.
  // Works on a stopped task. Refuses bad paths itself (BadRequestException, see assertWorktreePaths).
  hasFiles(taskId: string, paths: string[]): Promise<Record<string, boolean>>;
  // Text of one file in the task's worktree, or null when it is missing (also when the task folder is gone).
  // Works on a stopped task. Refuses a bad path itself (BadRequestException, see assertWorktreePaths);
  // throws WorktreeFileTooLargeError when the file is larger than maxBytes.
  readFile(taskId: string, path: string, maxBytes: number): Promise<string | null>;
}
