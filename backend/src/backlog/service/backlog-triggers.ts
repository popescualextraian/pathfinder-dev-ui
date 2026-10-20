import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface TriggerEvent {
  itemId: string;
  from: string;
  to: string;
  trigger: string;
  at: string;
}

// Trigger events for in-process listeners: emitted only by our own moves into a lane with a trigger.
@Injectable()
export class BacklogTriggers {
  private readonly subject = new Subject<TriggerEvent>();

  get events(): Observable<TriggerEvent> {
    return this.subject.asObservable();
  }

  emit(event: TriggerEvent): void {
    this.subject.next(event);
  }
}
