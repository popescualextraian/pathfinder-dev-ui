import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { BRIDGE_CLIENT_FACTORY, BridgeClientFactory, BridgeEvent } from './bridge-client';
import { hasSession } from './task-view';
import { TaskRecordRepository } from '../repository/task-record.repository';

@Injectable()
export class TaskEventsService {
  constructor(
    private readonly records: TaskRecordRepository,
    @Inject(BRIDGE_CLIENT_FACTORY) private readonly bridgeFor: BridgeClientFactory,
  ) {}

  // Throws NotFoundException unless the task exists (a malformed id counts as unknown), and, when
  // `session` is given, unless the task has that session (main always counts).
  async assertExists(id: string, session?: string): Promise<void> {
    let record;
    try {
      record = await this.records.get(id);
    } catch {
      record = undefined;
    }
    if (!record) throw new NotFoundException(`Task ${id} not found`);
    if (record.closed) throw new ConflictException(`Task ${id} is closed; its events are not available`);
    if (session !== undefined && !hasSession(record, session)) throw new NotFoundException(`Task ${id} has no session ${session}`);
  }

  // Backlog after `since`, then live events. Rejects with NotFoundException for an unknown task
  // (before any subscription). Unsubscribing aborts the bridge connection. Does not wake the task.
  // With `session` only that session's events pass: the bridge's WebSocket has no filter, so they are
  // filtered here by event `name`. Events without a `name` (task-level) pass through to every session's view.
  async stream(id: string, since: number, session?: string): Promise<Observable<BridgeEvent>> {
    const record = await this.records.get(id);
    if (!record) throw new NotFoundException(`Task ${id} not found`);
    if (record.closed) throw new ConflictException(`Task ${id} is closed; its events are not available`);
    if (session !== undefined && !hasSession(record, session)) throw new NotFoundException(`Task ${id} has no session ${session}`);
    const client = this.bridgeFor(record);
    return new Observable<BridgeEvent>((subscriber) => {
      const abort = new AbortController();
      void (async () => {
        try {
          for await (const event of client.eventStream(since, abort.signal)) {
            if (subscriber.closed) break;
            if (session === undefined || event.name == null || event.name === session) subscriber.next(event);
          }
          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      })();
      return () => abort.abort();
    });
  }
}
