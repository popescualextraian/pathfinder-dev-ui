import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query, Sse, UseFilters, UseGuards, MessageEvent,
} from '@nestjs/common';
import { catchError, map, Observable, throwError } from 'rxjs';
import { BridgeError, BridgeUnreachableError, TaskEvent } from '../../service/tasks/task-errors';
import { TaskEventsService } from '../../service/tasks/task-events.service';
import { TasksService, TaskView } from '../../service/tasks/tasks.service';
import { BridgeErrorFilter, describeBridgeError } from './bridge-error.filter';
import { AnswerDto } from './dto/answer.dto';
import { PromptDto } from './dto/prompt.dto';
import { SinceQueryDto } from './dto/since-query.dto';
import { StartTaskDto } from './dto/start-task.dto';
import { TaskExistsGuard } from './task-exists.guard';

// Status codes: POST /tasks 201 with the task; prompt, answer, cancel and stop 202 (the bridge
// accepts the command and works on it asynchronously) with the task view as of the answer; DELETE 204.
@Controller('tasks')
@UseFilters(BridgeErrorFilter)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly events: TaskEventsService,
  ) {}

  @Post()
  start(@Body() body: StartTaskDto): Promise<TaskView> {
    return this.tasks.start(body);
  }

  @Get()
  list(): Promise<TaskView[]> {
    return this.tasks.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<TaskView> {
    return this.tasks.get(id);
  }

  @Post(':id/prompt')
  @HttpCode(202)
  prompt(@Param('id') id: string, @Body() body: PromptDto): Promise<TaskView> {
    return this.tasks.prompt(id, body.text);
  }

  @Post(':id/answer')
  @HttpCode(202)
  answer(@Param('id') id: string, @Body() body: AnswerDto): Promise<TaskView> {
    return this.tasks.answer(id, { text: body.text, question: body.question });
  }

  @Post(':id/cancel')
  @HttpCode(202)
  cancel(@Param('id') id: string): Promise<TaskView> {
    return this.tasks.cancel(id);
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
    return this.tasks.events(id, query.since ?? 0);
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
    const events = await this.events.stream(id, fromHeader ?? query.since ?? 0);
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
