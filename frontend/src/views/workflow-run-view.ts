import type { WorkflowRun, WorkflowRunState, WorkflowRunStep, WorkflowSummary } from '../api/models';
import { isActiveRun } from '../state/use-workflow-runs';

/** What the board needs from useWorkflows/useWorkflowRuns; absent when workflows are off. */
export interface WorkflowBoard {
  definitions: WorkflowSummary[];
  /** Runs are loaded (not loading, no load error): until then no card may be dragged. */
  ready: boolean;
  runsByItem: Map<string, WorkflowRun>;
  actionState: (itemId: string) => { pending: boolean; error: string | null };
  start: (itemId: string, workflowId: string) => Promise<unknown>;
  advance: (runId: string, force?: boolean) => Promise<unknown>;
  stop: (runId: string) => Promise<unknown>;
}

export { isActiveRun };

export const STATE_LABEL: Record<WorkflowRunState, string> = {
  running: 'running',
  'needs-you': 'needs you',
  'awaiting-approval': 'awaiting approval',
  blocked: 'blocked',
  done: 'done',
  stopped: 'stopped',
  failed: 'failed',
};

const ATTENTION: readonly WorkflowRunState[] = ['needs-you', 'awaiting-approval', 'blocked', 'failed'];
export const needsAttention = (run: WorkflowRun) => ATTENTION.includes(run.state);

export const currentStep = (run: WorkflowRun): WorkflowRunStep | undefined => run.definition.steps[run.stepIndex];
export const nextStep = (run: WorkflowRun): WorkflowRunStep | undefined => run.definition.steps[run.stepIndex + 1];

/** `Plan · 1/3`. */
export function stepLabel(run: WorkflowRun): string {
  const step = currentStep(run);
  return `${step?.title ?? '?'} · ${run.stepIndex + 1}/${run.definition.steps.length}`;
}

/** The current step's last started session (its first one when none has started yet). */
export function currentSession(run: WorkflowRun): string {
  const sessions = currentStep(run)?.sessions ?? [];
  const started = sessions.filter((s) => (run.sessions[s.name]?.status ?? 'pending') !== 'pending');
  return (started[started.length - 1] ?? sessions[0])?.name ?? 'main';
}

export const openStepHref = (run: WorkflowRun) =>
  `#/tasks/${encodeURIComponent(run.taskId)}?session=${encodeURIComponent(currentSession(run))}`;

export const boardItemHref = (itemId: string) => `#/backlog?item=${encodeURIComponent(itemId)}`;

/** Continue/Finish is offered (and a drag to the next lane accepted) only while the run waits for approval. */
export const awaitingApproval = (run: WorkflowRun) => isActiveRun(run) && run.phase === 'awaiting-approval';
export const isBlocked = (run: WorkflowRun) => isActiveRun(run) && run.phase === 'blocked';

export type StepState = 'done' | 'current' | 'next';
export function stepStates(run: WorkflowRun): Array<{ step: WorkflowRunStep; state: StepState }> {
  return run.definition.steps.map((step, i) => ({
    step,
    state: i < run.stepIndex || (i === run.stepIndex && run.state === 'done') ? 'done' : i === run.stepIndex ? 'current' : 'next',
  }));
}
