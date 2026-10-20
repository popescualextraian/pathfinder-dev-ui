import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { Item } from './backlog-connector';

export type BacklogChange = { kind: 'item'; item: Item } | { kind: 'removed'; id: string } | { kind: 'error'; message?: string };

// Where changes of the cached items are announced (to the board stream).
@Injectable()
export class BacklogUpdates {
  private readonly subject = new Subject<BacklogChange>();

  get changes(): Observable<BacklogChange> {
    return this.subject.asObservable();
  }

  publish(change: BacklogChange): void {
    this.subject.next(change);
  }
}
