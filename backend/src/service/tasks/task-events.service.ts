import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { BRIDGE_CLIENT_FACTORY, BridgeClientFactory, BridgeEvent } from './bridge-client';
import { TaskRecordRepository } from '../../repository/tasks/task-record.repository';

@Injectable()
export class TaskEventsService {
  constructor(
    private readonly records: TaskRecordRepository,
    @Inject(BRIDGE_CLIENT_FACTORY) private readonly bridgeFor: BridgeClientFactory,
  ) {}

  // Throws NotFoundException unless the task exists (a malformed id counts as unknown).
  async assertExists(id: string): Promise<void> {
    let record;
    try {
      record = await this.records.get(id);
    } catch {
      record = undefined;
    }
    if (!record) throw new NotFoundException(`Task ${id} not found`);
    if (record.closed) throw new ConflictException(`Task ${id} is closed; its events are not available`);
  }

  // Backlog after `since`, then live events. Rejects with NotFoundException for an unknown task
  // (before any subscription). Unsubscribing aborts the bridge connection. Does not wake the task.
  async stream(id: string, since: number): Promise<Observable<BridgeEvent>> {
    const record = await this.records.get(id);
    if (!record) throw new NotFoundException(`Task ${id} not found`);
    if (record.closed) throw new ConflictException(`Task ${id} is closed; its events are not available`);
    const client = this.bridgeFor(record);
    return new Observable<BridgeEvent>((subscriber) => {
      const abort = new AbortController();
      void (async () => {
        try {
          for await (const event of client.eventStream(since, abort.signal)) {
            if (subscriber.closed) break;
            subscriber.next(event);
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
