import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { WorkflowConflictError, WorkflowFileTooLargeError, WorkflowInvalidError, WorkflowNotFoundError } from '../workflow-errors';
import { WORKFLOW_RETRY_DELAYS } from '../workflow-runner';
import type { RetryDelays } from '../workflow-runner';
import { WORKFLOW_TASKS, WorkflowSessionSnapshot, WorkflowTasks, WorkflowTaskSnapshot, WorkflowTaskState } from '../workflow-tasks';
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
// The agent's session stopped with an error: the generation fails (the runner shows these as needs-you).
const BROKEN: ReadonlySet<WorkflowTaskState> = new Set(['failed', 'interrupted']);

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
    let all: WorkflowGeneration[];
    try {
      all = await this.prune(await this.generations.list());
    } catch (error) {
      // The app starts anyway; list() reports the problem to clients.
      this.logger.error(`Workflow generations could not be read at startup: ${messageOf(error)}`);
      return;
    }
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
    const prompt = fillSkill({ description: text, stages: (await this.stages()) ?? [] });
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
      try {
        await this.generations.save(g);
      } catch (error) {
        // Nothing would follow the task: close it rather than leave an agent working for nobody.
        await this.tasks.close(taskId).catch((closeError: unknown) => {
          this.logger.warn(`Workflow generator task ${taskId} could not be closed: ${messageOf(closeError)}`);
        });
        throw error;
      }
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
      const n = structuredClone(g);
      n.state = 'writing';
      n.attempts = 0;
      delete n.draft;
      delete n.errors;
      delete n.warning;
      n.turn = { status: 'running' };
      n.outbox = { text: changesPrompt(text), ...await this.baselineOf(n.taskId) };
      // Recorded first: a restart before the send sends it then.
      const recorded = await this.persist(n, g);
      const sent = structuredClone(recorded);
      try {
        await this.deliver(sent);
      } catch (error) {
        // E.g. the task was stopped (the engine's 409): the caller gets it and the generation is ready again.
        await this.persist(structuredClone(g), recorded);
        throw error;
      }
      return toGenerationView(await this.persist(sent, recorded));
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

  // saved: stored first (the workflow is saved already), then the task is closed, a failure only logged (the task
  // stays in the task list). discard: the task is closed first; when that fails the caller gets the error and the
  // generation stays open (WorkflowTasks.close resolves for a task that is gone).
  private end(id: string, state: 'saved' | 'discarded', allowed: (g: WorkflowGeneration) => boolean): Promise<WorkflowGenerationView> {
    return this.exclusive(id, async () => {
      const g = await this.load(id);
      if (!allowed(g)) throw new WorkflowConflictError(`The generation is ${g.state}; it cannot be marked ${state}`);
      if (state === 'discarded') await this.tasks.close(g.taskId);
      const n = structuredClone(g);
      n.state = state;
      n.finishedAt = this.now();
      delete n.warning;
      delete n.outbox;
      const ended = await this.persist(n, g);
      if (state === 'saved') {
        try {
          await this.tasks.close(n.taskId);
        } catch (error) {
          this.logger.warn(`Workflow generation ${id}: could not close task ${n.taskId}: ${messageOf(error)}`);
        }
      }
      try {
        await this.prune(await this.generations.list());
      } catch (error) {
        this.logger.warn(`Workflow generations: could not remove expired ones: ${messageOf(error)}`);
      }
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

  // Look at the task: keep its question, last message and cost; while the agent works, send a recorded prompt, end
  // its turn, check the draft. Failed actions keep the generation as recorded with a warning and are retried.
  private async sync(id: string): Promise<void> {
    const g = await this.generations.get(id);
    if (!g || !isOpenGeneration(g)) return;
    let n = structuredClone(g);
    let failed = false;
    let snap: WorkflowTaskSnapshot | null | undefined;
    try {
      snap = await this.tasks.get(n.taskId);
    } catch (error) {
      n.warning = `could not read the task: ${messageOf(error)}`;
      await this.persist(n, g);
      if (isWorking(n)) this.scheduleRetry(id);
      return;
    }
    delete n.warning;
    if (!snap) {
      delete n.question;
      // A ready or failed generation keeps what it has: the draft can still be opened.
      if (isWorking(n)) this.fail(n, `task ${n.taskId} no longer exists`);
    } else {
      this.observeTask(n, snap);
      const problem = isWorking(n) ? problemOf(snap) : undefined;
      if (problem !== undefined) {
        this.fail(n, problem);
      } else if (isWorking(n)) {
        if (n.outbox) this.takenUp(n, snap);
        if (!n.outbox) {
          this.observeTurn(n, snap);
          const main = snap.sessions.find((s) => s.name === SESSION);
          // Checked only while the agent is idle with no question: never a half-written draft.
          if (n.turn.status === 'done' && main && IDLE.has(main.state) && main.openQuestions === 0) {
            const before = structuredClone(n);
            try {
              await this.check(n, main);
            } catch (error) {
              if (!(error instanceof GenerationFailure)) throw error;
              n = before;
              n.warning = error.message;
              failed = true;
            }
          }
        }
      }
    }
    this.deriveState(n, snap);
    n = await this.persist(n, g);
    // A prompt recorded (now or before a restart or a failed send) goes out after it is stored.
    if (n.outbox && isWorking(n)) {
      const sent = structuredClone(n);
      try {
        await this.deliver(sent);
      } catch (error) {
        sent.warning = `${n.attempts > 0 ? 'could not send the errors to the agent' : 'could not send the prompt to the agent'}: ${messageOf(error)}`;
        failed = true;
      }
      n = await this.persist(sent, n);
    }
    if (failed && isWorking(n)) this.scheduleRetry(id);
    else this.clearRetry(id);
  }

  // Sends the recorded prompt; then its turn is followed from a baseline read after sending. Throws what the port threw.
  private async deliver(n: WorkflowGeneration): Promise<void> {
    if (!n.outbox) return;
    await this.tasks.prompt(n.taskId, SESSION, n.outbox.text);
    delete n.outbox;
    n.turn = { status: 'running', ...await this.baselineOf(n.taskId) };
  }

  // A recorded prompt whose send failed (or was cut by a restart) may have reached the agent after all: busy, or a
  // new last message since it was recorded. Then it is not sent again and its turn is followed from the recording.
  private takenUp(n: WorkflowGeneration, snap: WorkflowTaskSnapshot): void {
    const main = snap.sessions.find((s) => s.name === SESSION);
    if (!n.outbox || !main) return;
    const busy = BUSY.has(main.state);
    if (!busy && main.lastMessageAt === n.outbox.baseline) return;
    n.turn = { status: 'running', ...(n.outbox.baseline !== undefined && { baseline: n.outbox.baseline }), ...(busy && { sawBusy: true }) };
    delete n.outbox;
  }

  private observeTask(n: WorkflowGeneration, snap: WorkflowTaskSnapshot): void {
    const question = snap.questions?.find((q) => q.session === SESSION);
    if (question) n.question = question; else delete n.question;
    const main = snap.sessions.find((s) => s.name === SESSION);
    if (main?.lastMessage !== undefined) n.lastMessage = main.lastMessage;
    if (snap.cost !== undefined) n.cost = snap.cost;
  }

  // The runner's rule: idle without an open question after the prompt, seen busy since or with a new last message.
  // A turn that ended but was not checked yet starts again when the agent works again (e.g. prompted by hand).
  private observeTurn(n: WorkflowGeneration, snap: WorkflowTaskSnapshot): void {
    const main = snap.sessions.find((s) => s.name === SESSION);
    if (!main) return;
    if (n.turn.status === 'done') {
      if (BUSY.has(main.state)) n.turn = { status: 'running', sawBusy: true };
      return;
    }
    if (BUSY.has(main.state)) n.turn.sawBusy = true;
    else if (IDLE.has(main.state) && main.openQuestions === 0 && (n.turn.sawBusy === true || main.lastMessageAt !== n.turn.baseline)) {
      n.turn = { status: 'done' };
    }
  }

  // The turn ended: read and check the draft; valid -> ready, else the errors are recorded for the agent or it fails.
  private async check(n: WorkflowGeneration, main: WorkflowSessionSnapshot): Promise<void> {
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
    // Recorded here, sent by sync() once stored.
    n.attempts += 1;
    n.errors = result.errors;
    delete n.draft;
    n.turn = { status: 'running' };
    n.outbox = {
      text: fixPrompt(result.errors, n.attempts, MAX_FIX_ATTEMPTS),
      ...(main.lastMessageAt !== undefined && { baseline: main.lastMessageAt }),
    };
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
    let stages: string[] | undefined;
    try {
      stages = await this.stages();
    } catch (error) {
      throw new GenerationFailure(`could not read the lanes: ${messageOf(error)}`);
    }
    return checkDraft(text, stages);
  }

  // Without stages from the work items any stage passes, as in the editor's validate.
  private async stages(): Promise<string[] | undefined> {
    return this.items.stages ? [...await this.items.stages()] : undefined;
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
    delete n.outbox;
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

// Why the agent cannot go on: the task failed or was stopped, or its session failed or was interrupted.
function problemOf(snap: WorkflowTaskSnapshot): string | undefined {
  if (snap.state === 'failed') return snap.failureReason ? `task failed: ${snap.failureReason}` : 'task failed';
  if (snap.state === 'stopped') return snap.failureReason ? `task was stopped: ${snap.failureReason}` : 'task was stopped';
  const main = snap.sessions.find((s) => s.name === SESSION);
  if (main && BROKEN.has(main.state)) return `the agent's session is ${main.state}`;
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
