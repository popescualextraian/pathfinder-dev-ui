import { ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { filter, map, Observable } from 'rxjs';
import { TasksService, TaskUpdates, TaskView, WorktreeFileTooLargeError } from '../../engine';
import { ScheduledTaskRefusedError } from '../../schedule';
import type {
  ScheduledTaskEnd, ScheduledTaskResult, ScheduledTasks, ScheduledTaskStart, ScheduledTaskStarted, ScheduledTaskStatus,
} from '../../schedule';

// States in which a task's bridge is (or should be) alive; a scheduled run outside them (or closed) has ended.
const LIVE_STATES: ReadonlySet<string> = new Set(['starting', 'running', 'waiting', 'idle']);

const ended = (view: TaskView): boolean => view.closed || !LIVE_STATES.has(view.state);

// A task closed while its run was live reads as stopped by hand.
function endState(view: TaskView): { state: string; reason?: string } {
  if (LIVE_STATES.has(view.state)) return { state: 'stopped', reason: view.reason || 'the task was closed' };
  return { state: view.state, ...(view.reason ? { reason: view.reason } : {}) };
}

const message = (error: unknown): string => (error instanceof Error ? error.message : 'unknown error');

/** The schedule package's view of the task engine, on the engine's public surface (`TasksService`, `TaskUpdates`). */
@Injectable()
export class EngineScheduledTasks implements ScheduledTasks {
  private readonly logger = new Logger(EngineScheduledTasks.name);
  readonly ends: Observable<ScheduledTaskEnd>;

  constructor(
    private readonly tasks: TasksService,
    private readonly updates: TaskUpdates,
  ) {
    this.ends = updates.changes.pipe(
      filter((change) => change.kind === 'task' && change.task.scheduleId !== undefined && ended(change.task)),
      map((change) => {
        const task = (change as { task: TaskView }).task;
        return {
          taskId: task.id, scheduleId: task.scheduleId as string, ...endState(task),
          ...(task.lastMessage !== undefined && { lastMessage: task.lastMessage }),
        };
      }),
    );
  }

  // The engine records and launches the task and then waits for its bridge; when that wait fails (502) the task exists
  // all the same. Its id is then taken from the engine's announcement of the new task of this schedule (created after
  // this call began), so the result follows it. A 409 before that is the running cap; other errors are refusals.
  async start(input: ScheduledTaskStart): Promise<ScheduledTaskStarted> {
    const startedAt = new Date().toISOString();
    let created: TaskView | undefined;
    const subscription = this.updates.changes.subscribe((change) => {
      if (created === undefined && change.kind === 'task' && change.task.scheduleId === input.scheduleId
        && change.task.prompt === input.prompt && change.task.createdAt >= startedAt) created = change.task;
    });
    try {
      const view = await this.tasks.start({
        title: input.title, prompt: input.prompt, repository: input.repository,
        ...(input.ref !== undefined && { repoRef: input.ref }),
        ...(input.model !== undefined && { model: input.model }),
        scheduled: { runTimeoutSeconds: input.timeoutSeconds },
        scheduleId: input.scheduleId, scheduleTitle: input.title,
      });
      return { taskId: view.id, ...(view.branch && { branch: view.branch }) };
    } catch (error) {
      if (created !== undefined) {
        this.logger.warn(`Task ${created.id} was created but did not answer yet; the schedule follows it: ${message(error)}`);
        return { taskId: created.id, ...(created.branch && { branch: created.branch }) };
      }
      if (error instanceof ConflictException) throw new ScheduledTaskRefusedError('cap', message(error));
      if (error instanceof HttpException) throw new ScheduledTaskRefusedError('other', message(error));
      throw error;
    } finally {
      subscription.unsubscribe();
    }
  }

  async get(taskId: string): Promise<ScheduledTaskStatus | undefined> {
    const view = await this.view(taskId);
    if (view === undefined) return undefined;
    if (ended(view)) return { taskId, ...endState(view), ended: true };
    return { taskId, state: view.state, ...(view.reason ? { reason: view.reason } : {}), ended: false };
  }

  async readResult(taskId: string): Promise<ScheduledTaskResult | undefined> {
    const view = await this.view(taskId);
    if (view === undefined) return undefined;
    const result: ScheduledTaskResult = { ...endState(view), summary: null, lastMessage: view.lastMessage ?? null };
    try {
      result.summary = await this.tasks.readTaskFile(taskId, 'result.md');
    } catch (error) {
      if (error instanceof WorktreeFileTooLargeError) result.summaryProblem = `result.md is larger than ${error.maxBytes / 1024} KB`;
      else if (error instanceof NotFoundException) return undefined;
      else result.summaryProblem = `result.md could not be read: ${message(error)}`;
    }
    return result;
  }

  private async view(taskId: string): Promise<TaskView | undefined> {
    try {
      return await this.tasks.get(taskId);
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }
}
