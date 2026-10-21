import type {
  BacklogItem, Repository, TaskRunInput, WorkflowRun, WorkflowRunState, WorkflowRunStep, WorkflowSummary,
} from '../api/models';
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
  /** For the New task dialog of "▶ Task". */
  repositories: Repository[];
  /** Starts a plain task on the item (a run of kind `task`); a failure is the item's action error. */
  startTask: (itemId: string, input: TaskRunInput) => Promise<{ ok: true; value: WorkflowRun } | { ok: false }>;
  /** Opens the task screen of a task just started. */
  onTaskStarted: (taskId: string) => void;
}

/** A plain task linked to the item: no workflow, no steps. */
export const isTaskRun = (run: WorkflowRun) => run.kind === 'task';

const KICKOFF_END = 'Read it and get familiar with it, then wait for my instructions. Do not change anything yet.';

// Limits of StartTaskRunDto (title, prompt).
const MAX_TITLE = 200;
const MAX_PROMPT = 20000;

/** The default title of "▶ Task": `#<id> <title>`, cut to the title limit. */
export function defaultTaskTitle(item: Pick<BacklogItem, 'id' | 'title'>): string {
  return `#${item.id} ${item.title}`.slice(0, MAX_TITLE);
}

/**
 * The default prompt of "▶ Task": the item, its description and link (each left out when empty), then wait.
 * The description is cut when the whole would pass the prompt limit.
 */
export function kickoffPrompt(item: Pick<BacklogItem, 'id' | 'title' | 'description' | 'url'>): string {
  const head = `We plan to work on backlog item #${item.id}: ${item.title}`;
  const url = item.url.trim();
  const build = (description: string) => [head, description, url, KICKOFF_END].filter(Boolean).join('\n\n');
  const description = item.description.trim();
  const over = build(description).length - MAX_PROMPT;
  return over > 0 ? build(description.slice(0, Math.max(0, description.length - over - 1)).trimEnd() + (description.length > over + 1 ? '…' : '')) : build(description);
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

/**
 * The task session a step runs in (same rule as the runner): an old run's saved `session` wins; the first step's is
 * `main`; a step that continues an earlier step's conversation uses that step's session (chains followed); every
 * other step has a session named after its id.
 */
export function sessionOfStep(steps: readonly WorkflowRunStep[], index: number): string {
  const step = steps[index];
  if (!step) return 'main';
  if (step.session !== undefined) return step.session;
  if (index === 0) return 'main';
  if (step.continue !== undefined) {
    const earlier = steps.findIndex((s) => s.id === step.continue);
    if (earlier >= 0 && earlier < index) return sessionOfStep(steps, earlier);
  }
  return step.id;
}

/** The session of the current step. */
export const currentSession = (run: WorkflowRun): string => sessionOfStep(run.definition.steps, run.stepIndex);

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
