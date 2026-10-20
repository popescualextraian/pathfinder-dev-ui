import { Body, Controller, Get, HttpCode, MessageEvent, Param, Post, Query, Sse, UseFilters } from '@nestjs/common';
import { interval, map, merge, Observable } from 'rxjs';
import { WorkflowRunner, WorkflowRunUpdates, WorkflowRunView } from '../../workflow';
import { BacklogErrorFilter } from '../backlog/backlog-error.filter';
import { BridgeErrorFilter } from '../tasks/bridge-error.filter';
import { AdvanceRunDto } from './dto/advance-run.dto';
import { RunsQueryDto } from './dto/runs-query.dto';
import { StartRunDto } from './dto/start-run.dto';
import { WorkflowErrorFilter } from './workflow-error.filter';

const PING_INTERVAL_MS = 25_000;

// Status codes: start 201 with the run; advance and stop 200 with the run. Unknown run, workflow or item 404; an item
// with an active run, or a run that cannot advance or stop now, 409. Errors the engine or the backlog give while a run
// starts or advances keep their mapping (engine 409/502, backlog 400/404/409/503, bridge errors as for tasks).
// Responses are run views: no tokens, no internal session fields.
@Controller('workflow-runs')
@UseFilters(WorkflowErrorFilter, BacklogErrorFilter, BridgeErrorFilter)
export class WorkflowRunsController {
  constructor(
    private readonly runner: WorkflowRunner,
    private readonly updates: WorkflowRunUpdates,
  ) {}

  // Runs stream, one per browser: `run` (data: the run) after every visible change of a run; nothing is replayed, the
  // client loads the list first. A comment line every 25 seconds keeps proxies from closing an idle connection.
  // Declared before `:id` so that `stream` is not taken for an id.
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const changes = this.updates.changes.pipe(map((run): MessageEvent => ({ type: 'run', data: run })));
    const pings = interval(PING_INTERVAL_MS).pipe(map((): MessageEvent => ({ comment: 'ping' })));
    return merge(changes, pings);
  }

  // All runs, active and finished, oldest first; or those of one item.
  @Get()
  list(@Query() query: RunsQueryDto): Promise<WorkflowRunView[]> {
    return this.runner.list(query.itemId ?? undefined);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<WorkflowRunView> {
    return this.runner.get(id);
  }

  @Post()
  start(@Body() body: StartRunDto): Promise<WorkflowRunView> {
    return this.runner.start(body.itemId, body.workflowId);
  }

  // "Continue", or "Start anyway" with force.
  @Post(':id/advance')
  @HttpCode(200)
  advance(@Param('id') id: string, @Body() body?: AdvanceRunDto): Promise<WorkflowRunView> {
    return this.runner.advance(id, { force: body?.force === true });
  }

  // Marks the run stopped; its task is left as it is.
  @Post(':id/stop')
  @HttpCode(200)
  stop(@Param('id') id: string): Promise<WorkflowRunView> {
    return this.runner.stop(id);
  }
}
