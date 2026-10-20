import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { WorkflowRunView } from './workflow-run';

// Where changes of workflow runs are announced (to the runs stream): the whole run after each change.
@Injectable()
export class WorkflowRunUpdates {
  private readonly subject = new Subject<WorkflowRunView>();

  get changes(): Observable<WorkflowRunView> {
    return this.subject.asObservable();
  }

  changed(run: WorkflowRunView): void {
    this.subject.next(run);
  }
}
