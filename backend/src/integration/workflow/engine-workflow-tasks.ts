import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { AddSessionInput, TasksService, TaskUpdates, TaskView, WorktreeFileTooLargeError } from '../../engine';
import { WorkflowFileTooLargeError } from '../../workflow';
import type {
  WorkflowSessionStart, WorkflowTaskCost, WorkflowTaskSnapshot, WorkflowTaskStart, WorkflowTasks, WorkflowTaskState,
} from '../../workflow';

const KNOWN_STATES: readonly WorkflowTaskState[] = ['starting', 'running', 'waiting', 'idle', 'suspended', 'stopped', 'failed', 'interrupted'];

// A state the workflow does not know reads as starting: neither busy nor done, so the runner waits.
function stateOf(raw: string): WorkflowTaskState {
  return (KNOWN_STATES as readonly string[]).includes(raw) ? (raw as WorkflowTaskState) : 'starting';
}

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

// The engine keeps the title as given, or shortened to 80 characters with an ellipsis.
function sameTitle(given: string, shown: string): boolean {
  const want = normalize(given);
  return shown === want || (shown.endsWith('…') && want.startsWith(shown.slice(0, -1)));
}

/** The workflow package's view of the task engine, on the engine's public surface (`TasksService`, `TaskUpdates`). */
@Injectable()
export class EngineWorkflowTasks implements WorkflowTasks {
  private readonly logger = new Logger(EngineWorkflowTasks.name);
  readonly changes: Observable<string>;

  constructor(
    private readonly tasks: TasksService,
    private readonly updates: TaskUpdates,
  ) {
    this.changes = updates.changes.pipe(map((change) => (change.kind === 'task' ? change.task.id : change.id)));
  }

  // In the given repository, else the default one. The engine records and launches the task and then waits for its bridge; when that wait
  // fails (502, bridge not ready) the task exists all the same and keeps starting. Its id is taken from the engine's
  // announcement of the new task (same prompt and title, created after this call began), so the run follows it rather
  // than leaving it orphaned. Errors before the task was created are passed on.
  async start(input: WorkflowTaskStart): Promise<string> {
    const startedAt = new Date().toISOString();
    let created: string | undefined;
    const ours = (task: TaskView): boolean =>
      task.prompt === input.prompt && task.createdAt >= startedAt && sameTitle(input.title, task.title);
    const subscription = this.updates.changes.subscribe((change) => {
      if (created === undefined && change.kind === 'task' && ours(change.task)) created = change.task.id;
    });
    try {
      const view = await this.tasks.start({
        title: input.title, prompt: input.prompt,
        ...(input.model !== undefined && { model: input.model }),
        ...(input.repository !== undefined && { repository: input.repository }),
        ...(input.kind !== undefined && { kind: input.kind }),
      });
      return view.id;
    } catch (error) {
      if (created === undefined) throw error;
      this.logger.warn(`Task ${created} was created but did not answer yet; the workflow follows it: ${error instanceof Error ? error.message : 'unknown error'}`);
      return created;
    } finally {
      subscription.unsubscribe();
    }
  }

  async addSession(taskId: string, session: WorkflowSessionStart): Promise<void> {
    const input: AddSessionInput = { name: session.name, prompt: session.prompt };
    if (session.fork !== undefined) input.forkFrom = session.fork;
    if (session.model !== undefined) input.model = session.model;
    await this.tasks.addSession(taskId, input);
  }

  async prompt(taskId: string, session: string, text: string): Promise<void> {
    await this.tasks.prompt(taskId, text, session);
  }

  // undefined for a task that is gone (deleted); a closed task reads as stopped (the engine's view says so).
  async get(taskId: string): Promise<WorkflowTaskSnapshot | undefined> {
    let view: TaskView;
    try {
      view = await this.tasks.get(taskId);
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
    const snapshot: WorkflowTaskSnapshot = {
      id: view.id,
      state: view.closed ? 'stopped' : stateOf(view.state),
      sessions: view.sessions.map((s) => ({
        name: s.name,
        state: view.closed ? 'stopped' : stateOf(s.state),
        openQuestions: s.questions,
        ...(s.lastMessageAt !== undefined && { lastMessageAt: s.lastMessageAt }),
        ...(s.lastMessage !== undefined && { lastMessage: s.lastMessage }),
      })),
    };
    if (view.branch) snapshot.branch = view.branch;
    if (view.questions.length > 0) {
      snapshot.questions = [...view.questions].sort((a, b) => a.asked.localeCompare(b.asked)).map((q) => ({
        id: q.id, session: q.session, text: q.text, options: [...q.options], asked: q.asked,
        ...(q.recommendation !== null && q.recommendation !== undefined && { recommendation: q.recommendation }),
      }));
    }
    if (view.cost !== undefined) snapshot.cost = costOf(view.cost);
    if (view.reason !== undefined && ['failed', 'stopped'].includes(snapshot.state)) snapshot.failureReason = view.reason;
    return snapshot;
  }

  hasFiles(taskId: string, paths: string[]): Promise<Record<string, boolean>> {
    return this.tasks.hasFiles(taskId, paths);
  }

  async readFile(taskId: string, path: string): Promise<string | null> {
    try {
      return await this.tasks.readFile(taskId, path);
    } catch (error) {
      if (error instanceof WorktreeFileTooLargeError) throw new WorkflowFileTooLargeError(`${path} is larger than ${error.maxBytes / 1024} KB`);
      throw error;
    }
  }

  // A task that is gone is as good as closed.
  async close(taskId: string): Promise<void> {
    try {
      await this.tasks.close(taskId);
    } catch (error) {
      if (error instanceof NotFoundException) return;
      throw error;
    }
  }
}

// Field by field: only the figures, not the engine's bookkeeping (snapshot and read times).
function costOf(cost: NonNullable<TaskView['cost']>): WorkflowTaskCost {
  const usd: WorkflowTaskCost['usd'] = {};
  if (cost.usd.estimate !== undefined) usd.estimate = cost.usd.estimate;
  if (cost.usd.billedCredits !== undefined) usd.billedCredits = cost.usd.billedCredits;
  if (cost.usd.unknown !== undefined) usd.unknown = cost.usd.unknown;
  return { input: cost.input, output: cost.output, cacheRead: cost.cacheRead, cacheWrite: cost.cacheWrite, usd };
}
