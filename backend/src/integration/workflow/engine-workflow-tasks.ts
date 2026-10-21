import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { AddSessionInput, TasksService, TaskUpdates, TaskView } from '../../engine';
import type {
  WorkflowSessionStart, WorkflowTaskSnapshot, WorkflowTaskStart, WorkflowTasks, WorkflowTaskState,
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

  // In the default repository. The engine records and launches the task and then waits for its bridge; when that wait
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
      const view = await this.tasks.start({ title: input.title, prompt: input.prompt, ...(input.model !== undefined && { model: input.model }), ...(input.kind !== undefined && { kind: input.kind }) });
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
      })),
    };
    if (view.branch) snapshot.branch = view.branch;
    if (view.reason !== undefined && ['failed', 'stopped'].includes(snapshot.state)) snapshot.failureReason = view.reason;
    return snapshot;
  }

  hasFiles(taskId: string, paths: string[]): Promise<Record<string, boolean>> {
    return this.tasks.hasFiles(taskId, paths);
  }

  readFile(taskId: string, path: string): Promise<string | null> {
    return this.tasks.readFile(taskId, path);
  }
}
