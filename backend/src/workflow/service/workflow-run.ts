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

export interface WorkflowRun {
  id: string;
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
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

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
export type WorkflowRunView = Omit<WorkflowRun, 'sessions'> & { sessions: Record<string, { status: RunSessionStatus }> };

export function toRunView(run: WorkflowRun): WorkflowRunView {
  const sessions = Object.fromEntries(Object.entries(run.sessions).map(([name, s]) => [name, { status: s.status }]));
  return { ...structuredClone(run), sessions };
}
