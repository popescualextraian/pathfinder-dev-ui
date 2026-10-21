import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { fillPlaceholders } from './placeholders';
import { isSafeRelativePath } from './requires-path';
import { forkSourceOf, sessionNames, sessionOfStep } from './step-session';
import type { StepDef } from './workflow-definition';
import { WORKFLOW_DEFINITION_REPOSITORY, WorkflowDefinitionRepository } from './workflow-definition.repository';
import { WorkflowConflictError, WorkflowNotFoundError } from './workflow-errors';
import {
  isActive, isTaskRun, newRunId, RunPhase, RunState, TASK_RUN_DEFINITION, toRunView, WorkflowRun, WorkflowRunView,
} from './workflow-run';
import { WORKFLOW_RUN_REPOSITORY, WorkflowRunRepository } from './workflow-run.repository';
import { WorkflowRunUpdates } from './workflow-run-updates';
import { WORKFLOW_TASKS, WorkflowTasks, WorkflowTaskSnapshot, WorkflowTaskState } from './workflow-tasks';
import { WORK_ITEMS, WorkItems } from './work-items';

// Evidence that a turn ran. Not 'starting': a session may read starting, then idle, before its prompt is taken up.
const BUSY: ReadonlySet<WorkflowTaskState> = new Set(['running', 'waiting']);
// Only idle: a suspended session may be one whose container was killed mid-turn.
const IDLE: ReadonlySet<WorkflowTaskState> = new Set(['idle']);
// A session in one of these states (or with an open question) needs the human.
const NEEDS_YOU: ReadonlySet<WorkflowTaskState> = new Set(['waiting', 'failed', 'interrupted']);
const PHASE_STATE: Record<RunPhase, RunState> = {
  sessions: 'running', exit: 'running', 'awaiting-approval': 'awaiting-approval', blocked: 'blocked',
};

// An action on the task or the item failed. Change-driven: the run keeps its phase and shows the message as a warning
// until a later change retries it. From advance(): the adapter's own error (`cause`) goes back to the caller.
class RunFailure extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
  }
}

// Not recoverable by retrying (e.g. a required path that is unsafe once filled in): the run fails with this reason.
class RunFatal extends Error {}

type Snapshot = WorkflowTaskSnapshot;

/** How many finished runs `list` returns (the most recently finished), besides all active ones. */
export const RECENT_FINISHED_RUNS = 50;

/** Delays of the retry of a run whose last action failed: initialMs, doubling up to maxMs. */
export interface RetryDelays {
  initialMs: number;
  maxMs: number;
}

/** A plain task on an item: the task's title (default `#<id> <title>`), first prompt, model and repository. */
export interface TaskRunStart {
  itemId: string;
  prompt: string;
  title?: string;
  model?: string;
  repository?: string;
}

export const WORKFLOW_RETRY_DELAYS = Symbol('WORKFLOW_RETRY_DELAYS');

/**
 * Drives workflow runs: one task per run, the steps' sessions one after another, gates, exit prompts, required files,
 * the item's stage. A plain-task run (`kind: 'task'`) only links a task to its item: no steps, no card moves; it
 * follows the task's state until stopped or the task is gone. Follows `WorkflowTasks.changes` (no polling). Work on one run is serialized, so concurrent
 * change events never start a session twice.
 */
@Injectable()
export class WorkflowRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowRunner.name);
  // Per key (run id, or `item:<id>` for starts): the tail of the queue of work on it.
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly pending = new Set<Promise<unknown>>();
  // Active runs by task id, so a change of a task finds its runs without reading every file.
  private readonly byTask = new Map<string, Set<string>>();
  private subscription?: { unsubscribe(): void };
  // Runs whose last action failed: the timer of their next retry and its delay.
  private readonly retries = new Map<string, { timer: ReturnType<typeof setTimeout>; delay: number }>();

  constructor(
    @Inject(WORKFLOW_TASKS) private readonly tasks: WorkflowTasks,
    @Inject(WORK_ITEMS) private readonly items: WorkItems,
    @Inject(WORKFLOW_DEFINITION_REPOSITORY) private readonly defs: WorkflowDefinitionRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY) private readonly runs: WorkflowRunRepository,
    private readonly updates: WorkflowRunUpdates,
    @Optional() @Inject(WORKFLOW_RETRY_DELAYS) private readonly retryDelays: RetryDelays = { initialMs: 5_000, maxMs: 60_000 },
  ) {}

  // Reload active runs and reconcile them with their tasks (a task that is gone fails its run), then follow changes.
  async onModuleInit(): Promise<void> {
    this.subscription = this.tasks.changes.subscribe((taskId) => { void this.onTaskChanged(taskId); });
    const active = (await this.runs.list()).filter(isActive);
    for (const run of active) this.index(run);
    await Promise.all(active.map((run) => this.syncLogged(run.id)));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    for (const runId of [...this.retries.keys()]) this.clearRetry(runId);
  }

  /** Resolves when all work queued so far (and work it queued) is done. */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /** Active runs and the most recently finished ones (RECENT_FINISHED_RUNS), oldest first; of all items or of one. */
  async list(itemId?: string): Promise<WorkflowRunView[]> {
    const all = (await this.runs.list()).filter((r) => itemId === undefined || r.itemId === itemId);
    const ended = (r: WorkflowRun) => r.finishedAt ?? r.updatedAt;
    const recent = new Set(all.filter((r) => !isActive(r))
      .sort((a, b) => ended(b).localeCompare(ended(a)))
      .slice(0, RECENT_FINISHED_RUNS)
      .map((r) => r.id));
    return all.filter((r) => isActive(r) || recent.has(r.id)).map(toRunView);
  }

  async get(runId: string): Promise<WorkflowRunView> {
    return toRunView(await this.load(runId));
  }

  private async load(runId: string): Promise<WorkflowRun> {
    const run = await this.runs.get(runId);
    if (!run) throw new WorkflowNotFoundError();
    return run;
  }

  async start(itemId: string, workflowId: string): Promise<WorkflowRunView> {
    const def = await this.defs.get(workflowId);
    if (!def) throw new WorkflowNotFoundError(`Workflow ${workflowId} not found`);
    return this.exclusive(`item:${itemId}`, async () => {
      const item = await this.freeItem(itemId);
      const step = def.steps[0];
      // The task does not exist yet: the parser refuses {{task.*}} in this prompt.
      const prompt = fillPlaceholders(step.prompt, { item, step });
      const taskId = await this.tasks.start({ title: `#${item.id} ${item.title}`, prompt, ...(step.model !== undefined && { model: step.model }) });

      const now = new Date().toISOString();
      const sessions = Object.fromEntries(sessionNames(def).map((name) => [name, { status: 'pending' as const }]));
      const run: WorkflowRun = {
        id: newRunId(), workflowId, definition: structuredClone(def), itemId, item: { ...item }, taskId, stepIndex: 0, phase: 'sessions',
        sessions: { ...sessions, [sessionOfStep(def, 0)]: { status: 'running' } }, state: 'running', pendingStage: step.stage,
        createdAt: now, updatedAt: now,
      };
      return this.record(run);
    });
  }

  /** Starts a plain task linked to the item: no card move, no steps; one active run per item, of either kind. */
  async startTask(input: TaskRunStart): Promise<WorkflowRunView> {
    const { itemId } = input;
    return this.exclusive(`item:${itemId}`, async () => {
      const item = await this.freeItem(itemId);
      const taskId = await this.tasks.start({
        title: input.title ?? `#${item.id} ${item.title}`, prompt: input.prompt,
        ...(input.model !== undefined && { model: input.model }),
        ...(input.repository !== undefined && { repository: input.repository }),
      });
      const now = new Date().toISOString();
      const run: WorkflowRun = {
        id: newRunId(), kind: 'task', workflowId: TASK_RUN_DEFINITION.id, definition: structuredClone(TASK_RUN_DEFINITION), itemId,
        item: { ...item }, taskId, stepIndex: 0, phase: 'sessions', sessions: {}, state: 'running', createdAt: now, updatedAt: now,
      };
      return this.record(run);
    });
  }

  // The item, when it exists and has no active run of either kind.
  private async freeItem(itemId: string) {
    if ((await this.runs.list()).some((r) => r.itemId === itemId && isActive(r))) {
      throw new WorkflowConflictError(`Item ${itemId} already has an active run`);
    }
    const item = await this.items.get(itemId);
    if (!item) throw new WorkflowNotFoundError(`Work item ${itemId} not found`);
    return item;
  }

  // Saves a new run and announces it. Holds the run's queue so change events of the new task wait until it is recorded.
  private record(run: WorkflowRun): Promise<WorkflowRunView> {
    return this.exclusive(run.id, async () => {
      await this.runs.save(run);
      this.index(run);
      this.updates.changed(toRunView(run));
      // Moves the card (a failure leaves a warning and is retried) and catches up with changes of the task that
      // came while it was being started, when there was no run yet.
      await this.sync(run.id);
      return toRunView(await this.load(run.id));
    });
  }

  /** "Continue" (or "Start anyway" with force): only from awaiting-approval or blocked. */
  advance(runId: string, options: { force?: boolean } = {}): Promise<WorkflowRunView> {
    return this.exclusive(runId, async () => {
      const run = await this.load(runId);
      if (isTaskRun(run)) throw new WorkflowConflictError('A plain task has no steps to continue');
      if (!isActive(run) || (run.phase !== 'awaiting-approval' && run.phase !== 'blocked')) {
        throw new WorkflowConflictError(`The run is ${run.state === 'needs-you' ? run.phase : run.state}; it continues only when awaiting approval or blocked`);
      }
      const r = structuredClone(run);
      const snap = await this.tasks.get(r.taskId);
      if (this.taskGone(r, snap)) return toRunView(await this.persist(r, run));
      try {
        const step = r.definition.steps[r.stepIndex];
        // From blocked the exit prompt was already sent.
        if (r.phase === 'awaiting-approval' && step.exitPrompt !== undefined) await this.sendExit(r, step, snap);
        else await this.moveOn(r, snap, options.force === true);
      } catch (error) {
        if (error instanceof RunFatal) {
          this.fail(r, error.message);
          return toRunView(await this.persist(r, run));
        }
        // The run stays as it was; the caller gets the adapter's error (e.g. the engine's 409).
        throw error instanceof RunFailure ? error.cause : error;
      }
      this.deriveState(r, snap);
      return toRunView(await this.persist(r, run));
    });
  }

  /** Marks the run stopped; the task is left as it is. */
  stop(runId: string): Promise<WorkflowRunView> {
    return this.exclusive(runId, async () => {
      const run = await this.load(runId);
      if (!isActive(run)) throw new WorkflowConflictError(`The run is already ${run.state}`);
      const r = structuredClone(run);
      this.finish(r, 'stopped');
      return toRunView(await this.persist(r, run));
    });
  }

  /** Processes a change of a task: every active run of it, one at a time per run. */
  async onTaskChanged(taskId: string): Promise<void> {
    if (!this.subscription) return;
    await Promise.all([...(this.byTask.get(taskId) ?? [])].map((runId) => this.syncLogged(runId)));
  }

  private syncLogged(runId: string): Promise<void> {
    return this.exclusive(runId, () => this.sync(runId)).catch((error: unknown) => {
      this.logger.error(`Workflow run ${runId}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  // Look at the task and do what follows from it: sessions done, next session, gate, exit, next step.
  private async sync(runId: string): Promise<void> {
    const run = await this.runs.get(runId);
    if (!run || !isActive(run)) return;
    const r = structuredClone(run);
    const snap = await this.tasks.get(r.taskId);
    if (this.taskGone(r, snap)) {
      await this.persist(r, run);
      return;
    }
    if (isTaskRun(r)) {
      this.deriveState(r, snap);
      await this.persist(r, run);
      return;
    }
    this.observe(r, snap);
    const observed = structuredClone(r);
    let current = r;
    let failed = false;
    try {
      await this.progress(r, snap);
      // Whatever failed before was retried by this pass and went through.
      if (isActive(r) && r.phase !== 'blocked') delete r.warning;
    } catch (error) {
      if (error instanceof RunFatal) {
        this.fail(r, error.message);
      } else {
        if (!(error instanceof RunFailure)) throw error;
        // Keep the phase (drop what this pass changed); retried on the next change of the task or by the timer.
        current = observed;
        current.warning = error.message;
        failed = true;
      }
    }
    this.deriveState(current, snap);
    await this.persist(current, run);
    if (failed && isActive(current)) this.scheduleRetry(runId);
    else this.clearRetry(runId);
  }

  // A session is done when it is idle with no open question after its turn: we saw it busy since we sent its prompt,
  // or its last message changed since then. "Idle" alone is not enough: right after a prompt it may still read idle.
  private observe(r: WorkflowRun, snap: Snapshot): void {
    for (const s of snap.sessions) {
      const mine = r.sessions[s.name];
      if (mine?.status !== 'running') continue;
      if (BUSY.has(s.state)) mine.sawBusy = true;
      else if (IDLE.has(s.state) && s.openQuestions === 0 && (mine.sawBusy === true || s.lastMessageAt !== mine.baseline)) {
        r.sessions[s.name] = { status: 'done' };
      }
    }
  }

  private async progress(r: WorkflowRun, snap: Snapshot): Promise<void> {
    const stage = r.pendingStage;
    if (stage !== undefined) {
      await this.attempt(`could not move the item to "${stage}"`, () => this.items.moveTo(r.itemId, stage));
      delete r.pendingStage;
    }
    const step = r.definition.steps[r.stepIndex];
    if (r.phase === 'sessions') {
      const mine = r.sessions[sessionOfStep(r.definition, r.stepIndex)] ?? { status: 'pending' };
      if (mine.status === 'done') await this.stepFinished(r, step, snap);
      else if (mine.status === 'pending') await this.startStep(r, snap);
    } else if (r.phase === 'exit') {
      if (r.sessions[sessionOfStep(r.definition, r.stepIndex)].status === 'done') await this.moveOn(r, snap, false);
    }
  }

  private async stepFinished(r: WorkflowRun, step: StepDef, snap: Snapshot): Promise<void> {
    if (step.gate === 'human') r.phase = 'awaiting-approval';
    else if (step.exitPrompt !== undefined) await this.sendExit(r, step, snap);
    else await this.moveOn(r, snap, false);
  }

  // Exit prompt to the step's session; the run continues when that session is done again.
  private async sendExit(r: WorkflowRun, step: StepDef, snap: Snapshot): Promise<void> {
    const last = sessionOfStep(r.definition, r.stepIndex);
    const text = fillPlaceholders(step.exitPrompt ?? '', this.context(r, step, snap));
    await this.attempt(`could not send the exit prompt to session "${last}"`, () => this.tasks.prompt(r.taskId, last, text));
    // Baseline read after sending: the engine's last message may lag behind and only show the previous turn now.
    r.sessions[last] = { status: 'running', ...await this.baselineOf(r.taskId, last) };
    r.phase = 'exit';
  }

  // The current step is over: check the next step's files, move the card, start its session; or finish.
  private async moveOn(r: WorkflowRun, snap: Snapshot, force: boolean): Promise<void> {
    const steps = r.definition.steps;
    const index = r.stepIndex + 1;
    if (index >= steps.length) {
      this.finish(r, 'done');
      const doneStage = r.definition.doneStage;
      if (doneStage !== undefined) {
        // The work is done; a failed card move does not undo that, it is a warning.
        try {
          await this.items.moveTo(r.itemId, doneStage);
        } catch (error) {
          r.warning = `could not move the item to "${doneStage}": ${messageOf(error)}`;
        }
      }
      return;
    }
    const next = steps[index];
    const paths = (next.requires ?? []).map((p) => fillPlaceholders(p, this.context(r, next, snap)));
    const unsafe = paths.find((p) => !isSafeRelativePath(p));
    if (unsafe !== undefined) throw new RunFatal(`required path "${unsafe}" is not a relative path inside the worktree`);
    if (paths.length > 0 && !force) {
      const found = await this.attempt('could not check the required files', () => this.tasks.hasFiles(r.taskId, paths));
      const missing = paths.filter((p) => found[p] !== true);
      if (missing.length > 0) {
        r.phase = 'blocked';
        r.warning = `Missing files: ${missing.join(', ')}`;
        return;
      }
    }
    delete r.warning;
    const stage = next.stage;
    if (stage !== undefined) await this.attempt(`could not move the item to "${stage}"`, () => this.items.moveTo(r.itemId, stage));
    r.stepIndex = index;
    r.phase = 'sessions';
    await this.startStep(r, snap);
  }

  // Starts the current step in its session: a new session (or a fork) is added; a continued one gets the prompt.
  private async startStep(r: WorkflowRun, snap: Snapshot): Promise<void> {
    const index = r.stepIndex;
    const step = r.definition.steps[index];
    const name = sessionOfStep(r.definition, index);
    const prompt = fillPlaceholders(step.prompt, this.context(r, step, snap));
    if (step.continue !== undefined) {
      // The session exists and was done: it gets this prompt and runs again, with a new baseline as for the exit
      // prompt. A crash between sending and saving sends the prompt twice (the same limit as the exit prompt).
      await this.attempt(`could not send the prompt of step "${step.id}" to session "${name}"`, () => this.tasks.prompt(r.taskId, name, prompt));
      r.sessions[name] = { status: 'running', ...await this.baselineOf(r.taskId, name) };
      return;
    }
    // Already there (we crashed after adding it, before saving): it is started, do not add it again.
    if (snap.sessions.some((s) => s.name === name)) {
      r.sessions[name] = { status: 'running' };
      return;
    }
    const fork = forkSourceOf(r.definition, index);
    await this.attempt(`could not start session "${name}"`, () => this.tasks.addSession(r.taskId, {
      name, prompt,
      ...(fork !== undefined && { fork }),
      ...(step.model !== undefined && { model: step.model }),
    }));
    r.sessions[name] = { status: 'running', ...await this.baselineOf(r.taskId, name) };
  }

  private async baselineOf(taskId: string, session: string): Promise<{ baseline?: string }> {
    const after = await this.tasks.get(taskId).catch(() => undefined);
    const baseline = after?.sessions.find((s) => s.name === session)?.lastMessageAt;
    return baseline === undefined ? {} : { baseline };
  }

  // Fails the run when its task is gone, failed or was stopped; true then.
  private taskGone(r: WorkflowRun, snap: Snapshot | null | undefined): snap is null | undefined {
    if (!snap) this.fail(r, `task ${r.taskId} no longer exists`);
    else if (snap.state === 'failed') this.fail(r, snap.failureReason ? `task failed: ${snap.failureReason}` : 'task failed');
    else if (snap.state === 'stopped') this.fail(r, snap.failureReason ? `task was stopped: ${snap.failureReason}` : 'task was stopped');
    else return false;
    return true;
  }

  // needs-you while a session of the run (of a plain task: any session of the task) has an open question or stopped
  // with an error; otherwise the state of the phase.
  private deriveState(r: WorkflowRun, snap: Snapshot | null | undefined): void {
    if (!isActive(r)) return;
    const needsYou = (snap?.sessions ?? []).some((s) => {
      const mine = isTaskRun(r) ? { status: 'running' } : r.sessions[s.name];
      return mine !== undefined && mine.status !== 'pending' && (s.openQuestions > 0 || NEEDS_YOU.has(s.state));
    });
    r.state = needsYou ? 'needs-you' : PHASE_STATE[r.phase];
  }

  private context(r: WorkflowRun, step: StepDef, snap: Snapshot) {
    return { item: r.item, step, task: { id: r.taskId, branch: snap.branch } };
  }

  private async attempt<T>(what: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throw new RunFailure(`${what}: ${messageOf(error)}`, error);
    }
  }

  private fail(r: WorkflowRun, reason: string): void {
    this.finish(r, 'failed');
    r.failureReason = reason;
    this.logger.warn(`Workflow run ${r.id} failed: ${reason}`);
  }

  private finish(r: WorkflowRun, state: 'done' | 'stopped' | 'failed'): void {
    r.state = state;
    r.finishedAt = new Date().toISOString();
  }

  // Saves the run if it changed; announces it only when what clients see changed.
  private async persist(r: WorkflowRun, before: WorkflowRun): Promise<WorkflowRun> {
    if (JSON.stringify(r) === JSON.stringify(before)) return before;
    const visible = JSON.stringify(toRunView(r)) !== JSON.stringify(toRunView(before));
    if (visible) r.updatedAt = new Date().toISOString();
    await this.runs.save(r);
    if (!isActive(r)) {
      this.unindex(r);
      this.clearRetry(r.id);
    }
    if (visible) this.updates.changed(toRunView(r));
    return r;
  }

  // Retry a run whose last action failed even when its task does not change: initialMs, doubling up to maxMs.
  private scheduleRetry(runId: string): void {
    if (!this.subscription) return; // shut down
    const previous = this.retries.get(runId);
    if (previous) clearTimeout(previous.timer);
    const delay = previous ? Math.min(previous.delay * 2, this.retryDelays.maxMs) : this.retryDelays.initialMs;
    const timer = setTimeout(() => { void this.syncLogged(runId); }, delay);
    timer.unref?.();
    this.retries.set(runId, { timer, delay });
  }

  private clearRetry(runId: string): void {
    const retry = this.retries.get(runId);
    if (!retry) return;
    clearTimeout(retry.timer);
    this.retries.delete(runId);
  }

  private index(run: WorkflowRun): void {
    const ids = this.byTask.get(run.taskId) ?? new Set<string>();
    ids.add(run.id);
    this.byTask.set(run.taskId, ids);
  }

  private unindex(run: WorkflowRun): void {
    const ids = this.byTask.get(run.taskId);
    ids?.delete(run.id);
    if (ids?.size === 0) this.byTask.delete(run.taskId);
  }

  private exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.then(work);
    const tail = result.catch(() => undefined);
    this.queues.set(key, tail);
    this.pending.add(tail);
    void tail.then(() => {
      this.pending.delete(tail);
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return result;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
