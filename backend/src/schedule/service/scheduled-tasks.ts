// What the scheduler needs from the task engine (implemented outside the package, on the engine's public surface).

/** A scheduled run to start: an ordinary task in the bridge's scheduled mode. */
export interface ScheduledTaskStart {
  scheduleId: string;
  /** The schedule's title: the task's title and the label shown on its card. */
  title: string;
  repository: string;
  ref?: string;
  model?: string;
  prompt: string;
  /** The bridge's run timeout (AGENTIC_RUN_TIMEOUT), whole seconds. */
  timeoutSeconds: number;
}

export interface ScheduledTaskStarted {
  taskId: string;
  branch?: string;
}

/** The engine refused to start the run: `cap` = the running cap is reached (409), `other` = any other refusal. */
export class ScheduledTaskRefusedError extends Error {
  constructor(readonly kind: 'cap' | 'other', message: string) {
    super(message);
    this.name = 'ScheduledTaskRefusedError';
  }
}

/** A scheduled task whose run has ended (stopped, failed, interrupted, closed). */
export interface ScheduledTaskEnd {
  taskId: string;
  scheduleId: string;
  state: string;
  reason?: string;
  lastMessage?: string;
}

/** Where a scheduled task stands, for the reconcile at startup. */
export interface ScheduledTaskStatus {
  taskId: string;
  state: string;
  reason?: string;
  /** The run is over (the task left the live states or was closed). */
  ended: boolean;
}

/** What a run left behind once it ended. */
export interface ScheduledTaskResult {
  state: string;
  reason?: string;
  /** Text of result.md; null when there is none or it could not be read (see summaryProblem). */
  summary: string | null;
  /** Why there is no summary, e.g. "the run wrote no result.md". */
  summaryProblem?: string;
  /** The agent's last message, null when none. */
  lastMessage: string | null;
}

/** Minimal observable (an rxjs Observable fits). */
export interface ScheduledTaskEnds {
  subscribe(listener: (end: ScheduledTaskEnd) => void): { unsubscribe(): void };
}

export interface ScheduledTasks {
  /** Starts the run; throws ScheduledTaskRefusedError when the engine refuses it. */
  start(input: ScheduledTaskStart): Promise<ScheduledTaskStarted>;
  /** Undefined for a task that is gone. */
  get(taskId: string): Promise<ScheduledTaskStatus | undefined>;
  /** Final state, summary (result.md) and last message of a run that ended; undefined for a task that is gone. */
  readResult(taskId: string): Promise<ScheduledTaskResult | undefined>;
  /** Scheduled tasks whose run ended (may repeat for one task, e.g. a later close). */
  readonly ends: ScheduledTaskEnds;
}

export const SCHEDULED_TASKS = Symbol('SCHEDULED_TASKS');
