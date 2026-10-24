import { randomBytes } from 'node:crypto';
import type { WorkflowDefinition } from './workflow-definition';
import type { WorkItem } from './work-items';

/** What clients see. `needs-you` is derived: some session of the run has an open question (or stopped with an error). */
export type RunState = 'running' | 'needs-you' | 'awaiting-approval' | 'blocked' | 'done' | 'stopped' | 'failed';

/**
 * Where an active run is, kept while `state` is `needs-you` so it resumes correctly:
 * `sessions` = the current step's sessions run; `exit` = the exit prompt was sent to the step's last session;
 * `awaiting-approval` = human gate; `blocked` = next step's required files are missing.
 */
export type RunPhase = 'sessions' | 'exit' | 'awaiting-approval' | 'blocked';

export type RunSessionStatus = 'pending' | 'running' | 'done';

export interface RunSession {
  status: RunSessionStatus;
  /** The session's lastMessageAt when we sent it its prompt; a different value means its turn ended. */
  baseline?: string;
  /** We saw it busy (running/waiting) since we sent the prompt. */
  sawBusy?: boolean;
}

/**
 * `task`: a plain task linked to the item (no workflow to follow: `workflowId` is TASK_RUN_DEFINITION's id, the
 * definition that one with no steps, `sessions` empty). Absent: a workflow run (also every run saved before task 019).
 */
export type RunKind = 'task';

export interface WorkflowRun {
  id: string;
  kind?: RunKind;
  workflowId: string;
  /** The definition as it was when the run started. */
  definition: WorkflowDefinition;
  itemId: string;
  /** The item as it was when the run started; placeholders are filled from it. */
  item: WorkItem;
  taskId: string;
  stepIndex: number;
  phase: RunPhase;
  /** Every session of the definition, by name. */
  sessions: Record<string, RunSession>;
  state: RunState;
  warning?: string;
  /** Internal: the item still has to be moved to this stage (its move at start failed; retried). */
  pendingStage?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

/** The stand-in definition of a plain-task run: titled "Task", no steps. */
export const TASK_RUN_DEFINITION: Readonly<WorkflowDefinition> = Object.freeze({ id: 'task', title: 'Task', steps: [] });

export const isTaskRun = (run: Pick<WorkflowRun, 'kind'>): boolean => run.kind === 'task';

export const ACTIVE_STATES: readonly RunState[] = ['running', 'needs-you', 'awaiting-approval', 'blocked'];
export const isActive = (run: Pick<WorkflowRun, 'state'>): boolean => ACTIVE_STATES.includes(run.state);

export const RUN_ID = /^R-\d{8}-[a-z0-9]{8}$/;

export function newRunId(now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const suffix = [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('');
  return `R-${day}-${suffix}`;
}

/** What the API and the runs stream show: the run without the runner's internal session fields. */
export type WorkflowRunView = Omit<WorkflowRun, 'sessions' | 'pendingStage'> & { sessions: Record<string, { status: RunSessionStatus }> };

export function toRunView(run: WorkflowRun): WorkflowRunView {
  const sessions = Object.fromEntries(Object.entries(run.sessions).map(([name, s]) => [name, { status: s.status }]));
  const { pendingStage: _internal, ...rest } = structuredClone(run); // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, sessions };
}
