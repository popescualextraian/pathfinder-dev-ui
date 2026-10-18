import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { TaskView } from './task-view';

export type TaskChange = { kind: 'task'; task: TaskView } | { kind: 'removed'; id: string };

// Where changes of task records are announced (to the status stream) and where actions leave a note
// for the poller: a task we just acted on is polled once even when it is idle.
@Injectable()
export class TaskUpdates {
  private readonly subject = new Subject<TaskChange>();
  private readonly acted = new Set<string>();

  get changes(): Observable<TaskChange> {
    return this.subject.asObservable();
  }

  changed(task: TaskView): void {
    this.subject.next({ kind: 'task', task });
  }

  removed(id: string): void {
    this.acted.delete(id);
    this.subject.next({ kind: 'removed', id });
  }

  markActed(id: string): void {
    this.acted.add(id);
  }

  actedIds(): ReadonlySet<string> {
    return new Set(this.acted);
  }

  clearActed(id: string): void {
    this.acted.delete(id);
  }
}
