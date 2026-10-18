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
}

export interface LaunchResult {
  bridgeUrl: string;
}

export interface TaskInspection {
  exists: boolean;
  running: boolean;
  bridgeUrl: string;
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
}
