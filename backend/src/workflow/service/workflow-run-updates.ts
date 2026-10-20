import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { WorkflowRun } from './workflow-run';

// Where changes of workflow runs are announced (to the runs stream): the whole run after each change.
@Injectable()
export class WorkflowRunUpdates {
  private readonly subject = new Subject<WorkflowRun>();

  get changes(): Observable<WorkflowRun> {
    return this.subject.asObservable();
  }

  changed(run: WorkflowRun): void {
    this.subject.next(run);
  }
}
