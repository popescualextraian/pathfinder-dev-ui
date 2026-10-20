import { Body, Controller, Get, HttpCode, MessageEvent, Param, Patch, Post, Put, Sse, UseFilters } from '@nestjs/common';
import { interval, map, merge, Observable } from 'rxjs';
import { BacklogChange, BacklogService, BacklogUpdates, FileLink, Item } from '../../backlog';
import { BacklogErrorFilter } from './backlog-error.filter';
import { CreateItemDto } from './dto/create-item.dto';
import { FileLinksDto } from './dto/file-links.dto';
import { MoveDto } from './dto/move.dto';
import { UpdateItemDto } from './dto/update-item.dto';

const PING_INTERVAL_MS = 25_000;

// Status codes: create answers 201 with the item; reads, update, move, file links and refresh answer 200 with the result.
@Controller('backlog')
@UseFilters(BacklogErrorFilter)
export class BacklogController {
  constructor(
    private readonly backlog: BacklogService,
    private readonly updates: BacklogUpdates,
  ) {}

  @Get('lanes')
  lanes(): { me: string; lanes: Array<{ id: string; title: string }> } {
    return this.backlog.lanes();
  }

  // Events `item` (data: the item) when one is added or changed, `removed` (data: {id}) and `error`
  // (data: {message}) when the source could not be read; nothing is replayed, the client loads the
  // list first. A comment line every 25 seconds keeps proxies from closing an idle connection.
  // Declared before the `:id` routes so that `stream` is not taken for an id.
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const changes = this.updates.changes.pipe(map(toEvent));
    const pings = interval(PING_INTERVAL_MS).pipe(map((): MessageEvent => ({ comment: 'ping' })));
    return merge(changes, pings);
  }

  @Get('items')
  list(): Promise<Item[]> {
    return this.backlog.list();
  }

  @Post('items')
  create(@Body() body: CreateItemDto): Promise<Item> {
    return this.backlog.create(body);
  }

  @Patch('items/:id')
  update(@Param('id') id: string, @Body() body: UpdateItemDto): Promise<Item> {
    return this.backlog.update(id, body);
  }

  @Get('items/:id')
  get(@Param('id') id: string): Promise<Item> {
    return this.backlog.get(id);
  }

  @Post('items/:id/move')
  @HttpCode(200)
  move(@Param('id') id: string, @Body() body: MoveDto): Promise<Item> {
    return this.backlog.move(id, body.from, body.to);
  }

  @Put('items/:id/file-links')
  setFileLinks(@Param('id') id: string, @Body() body: FileLinksDto): Promise<FileLink[]> {
    return this.backlog.setFileLinks(id, body.links);
  }

  // Reads the source now; 503 when it cannot be reached (the cache stays and keeps being listed).
  @Post('refresh')
  @HttpCode(200)
  refresh(): Promise<Item[]> {
    return this.backlog.refresh({ strict: true });
  }
}

function toEvent(change: BacklogChange): MessageEvent {
  switch (change.kind) {
    case 'item': return { type: 'item', data: change.item };
    case 'removed': return { type: 'removed', data: { id: change.id } };
    case 'error': return { type: 'error', data: { message: change.message ?? 'Backlog source failed' } };
  }
}
