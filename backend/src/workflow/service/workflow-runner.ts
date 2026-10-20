import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { fillPlaceholders } from './placeholders';
import type { SessionDef, StepDef, WorkflowDefinitions } from './workflow-definition';
import { WORKFLOW_DEFINITION_REPOSITORY, WorkflowDefinitionRepository } from './workflow-definition.repository';
import { WorkflowConflictError, WorkflowNotFoundError } from './workflow-errors';
import { isActive, newRunId, RunPhase, RunState, WorkflowRun } from './workflow-run';
import { WORKFLOW_RUN_REPOSITORY, WorkflowRunRepository } from './workflow-run.repository';
import { WorkflowRunUpdates } from './workflow-run-updates';
import { WORKFLOW_TASKS, WorkflowTasks, WorkflowTaskSnapshot, WorkflowTaskState } from './workflow-tasks';
import { WORK_ITEMS, WorkItems } from './work-items';

const BUSY: ReadonlySet<WorkflowTaskState> = new Set(['starting', 'running', 'waiting']);
const IDLE: ReadonlySet<WorkflowTaskState> = new Set(['idle', 'suspended']);
// A session in one of these states (or with an open question) needs the human.
const NEEDS_YOU: ReadonlySet<WorkflowTaskState> = new Set(['waiting', 'failed', 'interrupted']);
const PHASE_STATE: Record<RunPhase, RunState> = {
  sessions: 'running', exit: 'running', 'awaiting-approval': 'awaiting-approval', blocked: 'blocked',
};

// An action on the task or the item failed: the run fails with this message as its reason.
class RunFailure extends Error {}

type Snapshot = WorkflowTaskSnapshot;

/**
 * Drives workflow runs: one task per run, the steps' sessions one after another, gates, exit prompts, required files,
 * the item's stage. Follows `WorkflowTasks.changes` (no polling). Work on one run is serialized, so concurrent
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

  constructor(
    @Inject(WORKFLOW_TASKS) private readonly tasks: WorkflowTasks,
    @Inject(WORK_ITEMS) private readonly items: WorkItems,
    @Inject(WORKFLOW_DEFINITION_REPOSITORY) private readonly defs: WorkflowDefinitionRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY) private readonly runs: WorkflowRunRepository,
    private readonly updates: WorkflowRunUpdates,
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
  }

  /** Resolves when all work queued so far (and work it queued) is done. */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  definitions(): Promise<WorkflowDefinitions> {
    return this.defs.list();
  }

  /** All runs (oldest first), or those of one item. */
  async list(itemId?: string): Promise<WorkflowRun[]> {
    const all = await this.runs.list();
    return itemId === undefined ? all : all.filter((r) => r.itemId === itemId);
  }

  async get(runId: string): Promise<WorkflowRun> {
    const run = await this.runs.get(runId);
    if (!run) throw new WorkflowNotFoundError();
    return run;
  }

  async start(itemId: string, workflowId: string): Promise<WorkflowRun> {
    const def = await this.defs.get(workflowId);
    if (!def) throw new WorkflowNotFoundError(`Workflow ${workflowId} not found`);
    return this.exclusive(`item:${itemId}`, async () => {
      if ((await this.runs.list()).some((r) => r.itemId === itemId && isActive(r))) {
        throw new WorkflowConflictError(`Item ${itemId} already has an active workflow run`);
      }
      const item = await this.items.get(itemId);
      if (!item) throw new WorkflowNotFoundError(`Work item ${itemId} not found`);
      const step = def.steps[0];
      const first = step.sessions[0];
      // The task does not exist yet: {{task.id}} and {{task.branch}} are empty in this prompt.
      const prompt = fillPlaceholders(first.prompt, { item, step });
      const taskId = await this.tasks.start({ title: `#${item.id} ${item.title}`, prompt, ...(first.model !== undefined && { model: first.model }) });

      const now = new Date().toISOString();
      const sessions = Object.fromEntries(def.steps.flatMap((s) => s.sessions).map((s) => [s.name, { status: 'pending' as const }]));
      const run: WorkflowRun = {
        id: newRunId(), workflowId, definition: structuredClone(def), itemId, item: { ...item }, taskId, stepIndex: 0, phase: 'sessions',
        sessions: { ...sessions, [first.name]: { status: 'running' } }, state: 'running', createdAt: now, updatedAt: now,
      };
      // Hold the run's queue so change events of the new task wait until it is recorded and the card moved.
      return this.exclusive(run.id, async () => {
        await this.runs.save(run);
        this.index(run);
        this.updates.changed(run);
        const r = structuredClone(run);
        try {
          await this.attempt(`could not move the item to "${step.stage}"`, () => this.items.moveTo(itemId, step.stage));
        } catch (error) {
          this.failOn(error, r);
        }
        return this.persist(r, run);
      });
    });
  }

  /** "Continue" (or "Start anyway" with force): only from awaiting-approval or blocked. */
  advance(runId: string, options: { force?: boolean } = {}): Promise<WorkflowRun> {
    return this.exclusive(runId, async () => {
      const run = await this.get(runId);
      if (!isActive(run) || (run.phase !== 'awaiting-approval' && run.phase !== 'blocked')) {
        throw new WorkflowConflictError(`The run is ${run.state === 'needs-you' ? run.phase : run.state}; it continues only when awaiting approval or blocked`);
      }
      const r = structuredClone(run);
      const snap = await this.tasks.get(r.taskId);
      if (this.taskGone(r, snap)) return this.persist(r, run);
      try {
        const step = r.definition.steps[r.stepIndex];
        // From blocked the exit prompt was already sent.
        if (r.phase === 'awaiting-approval' && step.exitPrompt !== undefined) await this.sendExit(r, step, snap);
        else await this.moveOn(r, snap, options.force === true);
      } catch (error) {
        this.failOn(error, r);
      }
      this.deriveState(r, snap);
      return this.persist(r, run);
    });
  }

  /** Marks the run stopped; the task is left as it is. */
  stop(runId: string): Promise<WorkflowRun> {
    return this.exclusive(runId, async () => {
      const run = await this.get(runId);
      if (!isActive(run)) throw new WorkflowConflictError(`The run is already ${run.state}`);
      const r = structuredClone(run);
      this.finish(r, 'stopped');
      return this.persist(r, run);
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
    this.observe(r, snap);
    try {
      await this.progress(r, snap);
    } catch (error) {
      this.failOn(error, r);
    }
    this.deriveState(r, snap);
    await this.persist(r, run);
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
    const step = r.definition.steps[r.stepIndex];
    if (r.phase === 'sessions') {
      const next = step.sessions.find((s) => r.sessions[s.name].status !== 'done');
      if (!next) await this.stepFinished(r, step, snap);
      else if (r.sessions[next.name].status === 'pending') await this.startSession(r, step, next, snap);
    } else if (r.phase === 'exit') {
      if (r.sessions[step.sessions[step.sessions.length - 1].name].status === 'done') await this.moveOn(r, snap, false);
    }
  }

  private async stepFinished(r: WorkflowRun, step: StepDef, snap: Snapshot): Promise<void> {
    if (step.gate === 'human') r.phase = 'awaiting-approval';
    else if (step.exitPrompt !== undefined) await this.sendExit(r, step, snap);
    else await this.moveOn(r, snap, false);
  }

  // Exit prompt to the step's last session; the run continues when that session is done again.
  private async sendExit(r: WorkflowRun, step: StepDef, snap: Snapshot): Promise<void> {
    const last = step.sessions[step.sessions.length - 1].name;
    const baseline = snap.sessions.find((s) => s.name === last)?.lastMessageAt;
    const text = fillPlaceholders(step.exitPrompt ?? '', this.context(r, step, snap));
    await this.attempt(`could not send the exit prompt to session "${last}"`, () => this.tasks.prompt(r.taskId, last, text));
    r.sessions[last] = { status: 'running', ...(baseline !== undefined && { baseline }) };
    r.phase = 'exit';
  }

  // The current step is over: check the next step's files, move the card, start its first session; or finish.
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
    await this.attempt(`could not move the item to "${next.stage}"`, () => this.items.moveTo(r.itemId, next.stage));
    r.stepIndex = index;
    r.phase = 'sessions';
    await this.startSession(r, next, next.sessions[0], snap);
  }

  private async startSession(r: WorkflowRun, step: StepDef, session: SessionDef, snap: Snapshot): Promise<void> {
    const prompt = fillPlaceholders(session.prompt, this.context(r, step, snap));
    await this.attempt(`could not start session "${session.name}"`, () => this.tasks.addSession(r.taskId, {
      name: session.name, prompt,
      ...(session.fork !== undefined && { fork: session.fork }),
      ...(session.model !== undefined && { model: session.model }),
    }));
    r.sessions[session.name] = { status: 'running' };
  }

  // Fails the run when its task is gone, failed or was stopped; true then.
  private taskGone(r: WorkflowRun, snap: Snapshot | null | undefined): snap is null | undefined {
    if (!snap) this.fail(r, `task ${r.taskId} no longer exists`);
    else if (snap.state === 'failed') this.fail(r, snap.failureReason ? `task failed: ${snap.failureReason}` : 'task failed');
    else if (snap.state === 'stopped') this.fail(r, 'task was stopped');
    else return false;
    return true;
  }

  // needs-you while a session of the run has an open question; otherwise the state of the phase.
  private deriveState(r: WorkflowRun, snap: Snapshot | null | undefined): void {
    if (!isActive(r)) return;
    const needsYou = (snap?.sessions ?? []).some((s) => {
      const mine = r.sessions[s.name];
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
      throw new RunFailure(`${what}: ${messageOf(error)}`);
    }
  }

  private failOn(error: unknown, r: WorkflowRun): void {
    if (!(error instanceof RunFailure)) throw error;
    this.fail(r, error.message);
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

  // Saves and announces the run if it changed.
  private async persist(r: WorkflowRun, before: WorkflowRun): Promise<WorkflowRun> {
    if (JSON.stringify(r) === JSON.stringify(before)) return before;
    r.updatedAt = new Date().toISOString();
    await this.runs.save(r);
    if (!isActive(r)) this.unindex(r);
    this.updates.changed(r);
    return r;
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
