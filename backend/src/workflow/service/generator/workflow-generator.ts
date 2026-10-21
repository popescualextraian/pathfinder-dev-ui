import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { WorkflowConflictError, WorkflowFileTooLargeError, WorkflowInvalidError, WorkflowNotFoundError } from '../workflow-errors';
import { WORKFLOW_RETRY_DELAYS } from '../workflow-runner';
import type { RetryDelays } from '../workflow-runner';
import { WORKFLOW_TASKS, WorkflowTasks, WorkflowTaskSnapshot, WorkflowTaskState } from '../workflow-tasks';
import { WORK_ITEMS, WorkItems } from '../work-items';
import { checkDraft, DraftCheck } from './check-draft';
import { changesPrompt, DRAFT_FILE, fixPrompt } from './generator-prompts';
import { fillSkill } from './workflow-author';
import {
  isOpenGeneration, isWorking, MAX_FIX_ATTEMPTS, newGenerationId, toGenerationSummary, toGenerationView, WorkflowGeneration,
  WorkflowGenerationSummary, WorkflowGenerationView,
} from './workflow-generation';
import { WORKFLOW_GENERATION_REPOSITORY, WorkflowGenerationRepository } from './workflow-generation.repository';

/** The session the agent works in. */
const SESSION = 'main';
export const MAX_DESCRIPTION_LENGTH = 4000;
/** Saved and discarded generations are removed this long after they ended. */
export const GENERATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** The generator's clock (tests set it); `() => new Date()` by default. */
export const WORKFLOW_GENERATOR_CLOCK = Symbol('WORKFLOW_GENERATOR_CLOCK');

// The runner's turn rule: busy is evidence that a turn ran; only idle (not suspended) ends one.
const BUSY: ReadonlySet<WorkflowTaskState> = new Set(['running', 'waiting']);
const IDLE: ReadonlySet<WorkflowTaskState> = new Set(['idle']);

// An action on the task failed (reading the draft, sending a prompt): the generation keeps what it was, shows the
// message as a warning and is retried on the next change of the task or by the timer.
class GenerationFailure extends Error {}

/**
 * Generates a workflow definition with an agent: one task (kind workflow-generator) gets the workflow-author skill;
 * after each turn of its main session the generator reads `workflow-draft.yaml` from the task's worktree and checks it
 * with the editor's validator. Errors go back to the agent at most MAX_FIX_ATTEMPTS times. Follows
 * `WorkflowTasks.changes` (no polling); work on one generation is serialized.
 */
@Injectable()
export class WorkflowGenerator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowGenerator.name);
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly pending = new Set<Promise<unknown>>();
  // Open generations by task id.
  private readonly byTask = new Map<string, string>();
  private subscription?: { unsubscribe(): void };
  private readonly retries = new Map<string, { timer: ReturnType<typeof setTimeout>; delay: number }>();

  constructor(
    @Inject(WORKFLOW_TASKS) private readonly tasks: WorkflowTasks,
    @Inject(WORK_ITEMS) private readonly items: WorkItems,
    @Inject(WORKFLOW_GENERATION_REPOSITORY) private readonly generations: WorkflowGenerationRepository,
    @Optional() @Inject(WORKFLOW_RETRY_DELAYS) private readonly retryDelays: RetryDelays = { initialMs: 5_000, maxMs: 60_000 },
    @Optional() @Inject(WORKFLOW_GENERATOR_CLOCK) private readonly clock: () => Date = () => new Date(),
  ) {}

  // Drop expired ones, reload the open ones and reconcile them with their tasks, then follow changes.
  async onModuleInit(): Promise<void> {
    this.subscription = this.tasks.changes.subscribe((taskId) => { void this.onTaskChanged(taskId); });
    const all = await this.prune(await this.generations.list());
    const open = all.filter(isOpenGeneration);
    for (const g of open) this.byTask.set(g.taskId, g.id);
    await Promise.all(open.map((g) => this.syncLogged(g.id)));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    for (const id of [...this.retries.keys()]) this.clearRetry(id);
  }

  /** Resolves when all work queued so far (and work it queued) is done. */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /** Starts a generator task for the description (1..4000 characters); model empty or absent = the default. */
  async start(description: string, model?: string): Promise<WorkflowGenerationView> {
    const text = description.trim();
    if (text === '' || text.length > MAX_DESCRIPTION_LENGTH) {
      throw new WorkflowInvalidError(`The description must have 1 to ${MAX_DESCRIPTION_LENGTH} characters`);
    }
    const chosen = model?.trim() || undefined;
    const prompt = fillSkill({ description: text, stages: await this.stages() });
    const firstLine = text.split('\n')[0].trim();
    const taskId = await this.tasks.start({
      title: `Workflow generator: ${firstLine}`, prompt, kind: 'workflow-generator', ...(chosen !== undefined && { model: chosen }),
    });
    const now = this.now();
    const g: WorkflowGeneration = {
      id: newGenerationId(this.clock()), taskId, description: text, ...(chosen !== undefined && { model: chosen }),
      state: 'writing', attempts: 0, turn: { status: 'running' }, createdAt: now, updatedAt: now,
    };
    // Hold its queue so change events of the new task wait until it is recorded, then catch up with them.
    return this.exclusive(g.id, async () => {
      await this.generations.save(g);
      this.byTask.set(taskId, g.id);
      await this.sync(g.id);
      return toGenerationView(await this.load(g.id));
    });
  }

  /** The open generations (not saved or discarded), oldest first, without their drafts. */
  async list(): Promise<WorkflowGenerationSummary[]> {
    const all = await this.prune(await this.generations.list());
    return all.filter(isOpenGeneration).map(toGenerationSummary);
  }

  /** One generation with its draft (also a saved or discarded one, until it expires). */
  async get(id: string): Promise<WorkflowGenerationView> {
    return toGenerationView(await this.load(id));
  }

  /** Only from ready: the human's text goes to the agent; the draft is written again and checked as before. */
  requestChanges(id: string, text: string): Promise<WorkflowGenerationView> {
    return this.exclusive(id, async () => {
      const g = await this.load(id);
      if (g.state !== 'ready') throw new WorkflowConflictError(`The generation is ${g.state}; changes can be requested only for a ready draft`);
      if (text.trim() === '') throw new WorkflowInvalidError('The change request is empty');
      // A failure (e.g. the task was stopped: the engine's 409) goes to the caller; the generation stays ready.
      await this.tasks.prompt(g.taskId, SESSION, changesPrompt(text));
      const n = structuredClone(g);
      n.state = 'writing';
      n.attempts = 0;
      delete n.draft;
      delete n.errors;
      delete n.warning;
      n.turn = { status: 'running', ...await this.baselineOf(n.taskId) };
      return toGenerationView(await this.persist(n, g));
    });
  }

  /** The draft was saved as a workflow (from ready or failed): ends the generation and closes its task. */
  saved(id: string): Promise<WorkflowGenerationView> {
    return this.end(id, 'saved', (g) => g.state === 'ready' || g.state === 'failed');
  }

  /** From any open state: ends the generation and closes its task. */
  discard(id: string): Promise<WorkflowGenerationView> {
    return this.end(id, 'discarded', isOpenGeneration);
  }

  /** Processes a change of a task: its open generation, if any. */
  async onTaskChanged(taskId: string): Promise<void> {
    if (!this.subscription) return;
    const id = this.byTask.get(taskId);
    if (id !== undefined) await this.syncLogged(id);
  }

  private end(id: string, state: 'saved' | 'discarded', allowed: (g: WorkflowGeneration) => boolean): Promise<WorkflowGenerationView> {
    return this.exclusive(id, async () => {
      const g = await this.load(id);
      if (!allowed(g)) throw new WorkflowConflictError(`The generation is ${g.state}; it cannot be marked ${state}`);
      const n = structuredClone(g);
      n.state = state;
      n.finishedAt = this.now();
      delete n.warning;
      const ended = await this.persist(n, g);
      // The generation has ended either way; a task that stays open shows in the task list and can be closed there.
      try {
        await this.tasks.close(n.taskId);
      } catch (error) {
        this.logger.warn(`Workflow generation ${id}: could not close task ${n.taskId}: ${messageOf(error)}`);
      }
      await this.prune(await this.generations.list()).catch((error: unknown) => {
        this.logger.warn(`Workflow generations: could not remove expired ones: ${messageOf(error)}`);
      });
      return toGenerationView(ended);
    });
  }

  private async load(id: string): Promise<WorkflowGeneration> {
    const g = await this.generations.get(id);
    if (!g) throw new WorkflowNotFoundError('Workflow generation not found');
    return g;
  }

  private syncLogged(id: string): Promise<void> {
    return this.exclusive(id, () => this.sync(id)).catch((error: unknown) => {
      this.logger.error(`Workflow generation ${id}: ${messageOf(error)}`);
    });
  }

  // Look at the task: keep its question, last message and cost; while the agent works, end its turn, check the draft.
  private async sync(id: string): Promise<void> {
    const g = await this.generations.get(id);
    if (!g || !isOpenGeneration(g)) return;
    let n = structuredClone(g);
    const snap = await this.tasks.get(n.taskId);
    let failed = false;
    if (!snap) {
      delete n.question;
      // A ready or failed generation keeps what it has: the draft can still be opened.
      if (isWorking(n)) this.fail(n, `task ${n.taskId} no longer exists`);
    } else {
      this.observeTask(n, snap);
      if (isWorking(n) && (snap.state === 'failed' || snap.state === 'stopped')) {
        const why = snap.state === 'failed' ? 'task failed' : 'task was stopped';
        this.fail(n, snap.failureReason ? `${why}: ${snap.failureReason}` : why);
      } else if (isWorking(n)) {
        this.observeTurn(n, snap);
        const observed = structuredClone(n);
        try {
          if (n.turn.status === 'done') await this.check(n);
          delete n.warning;
        } catch (error) {
          if (!(error instanceof GenerationFailure)) throw error;
          // Keep the turn done and unchecked; retried on the next change or by the timer.
          n = observed;
          n.warning = error.message;
          failed = true;
        }
      }
    }
    this.deriveState(n, snap);
    await this.persist(n, g);
    if (failed && isWorking(n)) this.scheduleRetry(id);
    else this.clearRetry(id);
  }

  private observeTask(n: WorkflowGeneration, snap: WorkflowTaskSnapshot): void {
    const question = snap.questions?.find((q) => q.session === SESSION);
    if (question) n.question = question; else delete n.question;
    const main = snap.sessions.find((s) => s.name === SESSION);
    if (main?.lastMessage !== undefined) n.lastMessage = main.lastMessage;
    if (snap.cost !== undefined) n.cost = snap.cost;
  }

  // The runner's rule: idle without an open question after the prompt, seen busy since or with a new last message.
  private observeTurn(n: WorkflowGeneration, snap: WorkflowTaskSnapshot): void {
    const main = snap.sessions.find((s) => s.name === SESSION);
    if (!main || n.turn.status !== 'running') return;
    if (BUSY.has(main.state)) n.turn.sawBusy = true;
    else if (IDLE.has(main.state) && main.openQuestions === 0 && (n.turn.sawBusy === true || main.lastMessageAt !== n.turn.baseline)) {
      n.turn = { status: 'done' };
    }
  }

  // The turn ended: read and check the draft; valid -> ready, else the errors go back to the agent or it fails.
  private async check(n: WorkflowGeneration): Promise<void> {
    const result = await this.readAndCheck(n.taskId);
    if (result.valid) {
      n.state = 'ready';
      n.draft = result.definition;
      delete n.errors;
      return;
    }
    if (n.attempts >= MAX_FIX_ATTEMPTS) {
      n.state = 'failed';
      n.errors = result.errors;
      if (result.draft !== undefined) n.draft = result.draft; else delete n.draft;
      this.logger.warn(`Workflow generation ${n.id} failed: the draft still has errors after ${MAX_FIX_ATTEMPTS} fixes`);
      return;
    }
    const attempt = n.attempts + 1;
    try {
      await this.tasks.prompt(n.taskId, SESSION, fixPrompt(result.errors, attempt, MAX_FIX_ATTEMPTS));
    } catch (error) {
      throw new GenerationFailure(`could not send the errors to the agent: ${messageOf(error)}`);
    }
    n.attempts = attempt;
    n.errors = result.errors;
    delete n.draft;
    n.turn = { status: 'running', ...await this.baselineOf(n.taskId) };
  }

  // A file over the cap is the agent's to fix, like a missing one; any other read error is retried.
  private async readAndCheck(taskId: string): Promise<DraftCheck> {
    let text: string | null;
    try {
      text = await this.tasks.readFile(taskId, DRAFT_FILE);
    } catch (error) {
      if (error instanceof WorkflowFileTooLargeError) return { valid: false, errors: [{ message: error.message }] };
      throw new GenerationFailure(`could not read ${DRAFT_FILE}: ${messageOf(error)}`);
    }
    let stages: string[];
    try {
      stages = await this.stages();
    } catch (error) {
      throw new GenerationFailure(`could not read the lanes: ${messageOf(error)}`);
    }
    return checkDraft(text, stages);
  }

  private async stages(): Promise<string[]> {
    return this.items.stages ? [...await this.items.stages()] : [];
  }

  // Read after sending: the engine's last message may lag behind and only show the previous turn now.
  private async baselineOf(taskId: string): Promise<{ baseline?: string }> {
    const after = await this.tasks.get(taskId).catch(() => undefined);
    const baseline = after?.sessions.find((s) => s.name === SESSION)?.lastMessageAt;
    return baseline === undefined ? {} : { baseline };
  }

  // While the agent works: asking with an open question, else fixing once errors went back, else writing.
  private deriveState(n: WorkflowGeneration, snap: WorkflowTaskSnapshot | null | undefined): void {
    if (!isWorking(n)) return;
    const main = snap?.sessions.find((s) => s.name === SESSION);
    const asking = n.question !== undefined || (main?.openQuestions ?? 0) > 0;
    n.state = asking ? 'asking' : n.attempts > 0 ? 'fixing' : 'writing';
  }

  private fail(n: WorkflowGeneration, reason: string): void {
    n.state = 'failed';
    n.failureReason = reason;
    delete n.question;
    this.logger.warn(`Workflow generation ${n.id} failed: ${reason}`);
  }

  // Saves it if it changed (updatedAt only when what clients see changed).
  private async persist(n: WorkflowGeneration, before: WorkflowGeneration): Promise<WorkflowGeneration> {
    if (JSON.stringify(n) === JSON.stringify(before)) return before;
    if (JSON.stringify(toGenerationView(n)) !== JSON.stringify(toGenerationView(before))) n.updatedAt = this.now();
    await this.generations.save(n);
    if (!isOpenGeneration(n)) {
      if (this.byTask.get(n.taskId) === n.id) this.byTask.delete(n.taskId);
      this.clearRetry(n.id);
    }
    return n;
  }

  // Removes saved and discarded generations that ended more than GENERATION_RETENTION_MS ago; returns the rest.
  private async prune(all: WorkflowGeneration[]): Promise<WorkflowGeneration[]> {
    const limit = this.clock().getTime() - GENERATION_RETENTION_MS;
    const kept: WorkflowGeneration[] = [];
    for (const g of all) {
      const ended = !isOpenGeneration(g) ? Date.parse(g.finishedAt ?? g.updatedAt) : NaN;
      if (ended < limit) await this.generations.delete(g.id);
      else kept.push(g);
    }
    return kept;
  }

  private scheduleRetry(id: string): void {
    if (!this.subscription) return; // shut down
    const previous = this.retries.get(id);
    if (previous) clearTimeout(previous.timer);
    const delay = previous ? Math.min(previous.delay * 2, this.retryDelays.maxMs) : this.retryDelays.initialMs;
    const timer = setTimeout(() => { void this.syncLogged(id); }, delay);
    timer.unref?.();
    this.retries.set(id, { timer, delay });
  }

  private clearRetry(id: string): void {
    const retry = this.retries.get(id);
    if (!retry) return;
    clearTimeout(retry.timer);
    this.retries.delete(id);
  }

  private now(): string {
    return this.clock().toISOString();
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
