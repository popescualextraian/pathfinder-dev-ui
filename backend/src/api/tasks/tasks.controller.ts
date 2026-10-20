import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, Sse, UseFilters, UseGuards, MessageEvent,
} from '@nestjs/common';
import { catchError, interval, map, merge, Observable, throwError } from 'rxjs';
import { BridgeError, BridgeUnreachableError, SessionView, TaskEvent, TaskEventsService, TasksService, TaskUpdates, TaskView } from '../../engine';
import { BridgeErrorFilter, describeBridgeError } from './bridge-error.filter';
import { AddSessionDto } from './dto/add-session.dto';
import { AnswerDto } from './dto/answer.dto';
import { CancelDto } from './dto/cancel.dto';
import { PromptDto } from './dto/prompt.dto';
import { SinceQueryDto } from './dto/since-query.dto';
import { StartTaskDto } from './dto/start-task.dto';
import { TaskExistsGuard } from './task-exists.guard';

const PING_INTERVAL_MS = 25_000;

// Status codes: POST /tasks 201 with the task; prompt, answer, cancel and stop 202 (the bridge
// accepts the command and works on it asynchronously) with the task view as of the answer; DELETE 204.
@Controller('tasks')
@UseFilters(BridgeErrorFilter)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly events: TaskEventsService,
    private readonly updates: TaskUpdates,
  ) {}

  @Post()
  start(@Body() body: StartTaskDto): Promise<TaskView> {
    return this.tasks.start(body);
  }

  // Status stream, one per browser: `task` (data: the task) when a task is created or changed,
  // `removed` (data: {id}) when one is deleted; nothing is replayed, the client loads the list first.
  // A comment line every 25 seconds keeps proxies from closing an idle connection.
  // Declared before `:id` routes so that `stream` is not taken for an id.
  @Sse('stream')
  statusStream(): Observable<MessageEvent> {
    const changes = this.updates.changes.pipe(
      map((change): MessageEvent => (change.kind === 'task' ? { type: 'task', data: change.task } : { type: 'removed', data: { id: change.id } })),
    );
    const pings = interval(PING_INTERVAL_MS).pipe(map((): MessageEvent => ({ comment: 'ping' })));
    return merge(changes, pings);
  }

  @Get()
  list(): Promise<TaskView[]> {
    return this.tasks.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<TaskView> {
    return this.tasks.get(id);
  }

  @Get(':id/sessions')
  async sessions(@Param('id') id: string): Promise<SessionView[]> {
    return (await this.tasks.get(id)).sessions;
  }

  // 201 with the task view; 400 for a bad name, 404 for an unknown forkFrom, 409 for a name that is
  // taken, a busy source or a stopped task (the bridge decides).
  @Post(':id/sessions')
  addSession(@Param('id') id: string, @Body() body: AddSessionDto): Promise<TaskView> {
    return this.tasks.addSession(id, { name: body.name, model: body.model, forkFrom: body.forkFrom, prompt: body.prompt });
  }

  @Post(':id/prompt')
  @HttpCode(202)
  prompt(@Param('id') id: string, @Body() body: PromptDto): Promise<TaskView> {
    return this.tasks.prompt(id, body.text, body.session ?? undefined);
  }

  @Post(':id/answer')
  @HttpCode(202)
  answer(@Param('id') id: string, @Body() body: AnswerDto): Promise<TaskView> {
    return this.tasks.answer(id, { text: body.text, question: body.question, session: body.session ?? undefined });
  }

  @Post(':id/cancel')
  @HttpCode(202)
  cancel(@Param('id') id: string, @Body() body?: CancelDto): Promise<TaskView> {
    return this.tasks.cancel(id, body?.session ?? undefined);
  }

  @Post(':id/close')
  @HttpCode(202)
  close(@Param('id') id: string): Promise<TaskView> {
    return this.tasks.close(id);
  }

  @Post(':id/stop')
  @HttpCode(202)
  stop(@Param('id') id: string): Promise<TaskView> {
    return this.tasks.stop(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.tasks.remove(id);
  }

  @Get(':id/events')
  eventList(@Param('id') id: string, @Query() query: SinceQueryDto): Promise<TaskEvent[]> {
    return this.tasks.events(id, query.since ?? 0, query.session ?? undefined);
  }

  // Backlog after Last-Event-ID (which EventSource sends on reconnect) or else `since`, then live.
  // The SSE id is the event's seq. The subscription ends, and with it the bridge connection,
  // when the client disconnects.
  // Nest starts the SSE response before an async handler settles, so a failure inside it would reach
  // the client as a 200 with an error event: the guard turns an unknown task into a real 404 first,
  // and errors that happen later are reduced to the generic message the filter would give.
  @Sse(':id/events/stream')
  @UseGuards(TaskExistsGuard)
  async stream(
    @Param('id') id: string,
    @Query() query: SinceQueryDto,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<Observable<MessageEvent>> {
    // On reconnect EventSource repeats the original URL (with its `since`) and adds Last-Event-ID:
    // the header is where the client really got to, so it wins.
    const fromHeader = lastEventId !== undefined && /^\d+$/.test(lastEventId) ? Number(lastEventId) : undefined;
    const events = await this.events.stream(id, fromHeader ?? query.since ?? 0, query.session ?? undefined);
    return events.pipe(
      map((event) => ({ id: String(event.seq), data: event })),
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof BridgeError || error instanceof BridgeUnreachableError
            ? new Error(describeBridgeError(error).message)
            : new Error('The event stream failed'),
        ),
      ),
    );
  }
}
