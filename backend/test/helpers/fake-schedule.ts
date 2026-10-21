import { Subject } from 'rxjs';
import {
  MAX_RESULTS, ScheduleClock, ScheduledTaskEnd, ScheduledTaskRefusedError, ScheduledTaskResult, ScheduledTasks, ScheduledTaskStart,
  ScheduledTaskStarted, ScheduledTaskStatus, ScheduleRecord, ScheduleRepository,
} from '../../src/schedule';

/** A clock tests move by hand. */
export class FakeClock implements ScheduleClock {
  constructor(private time: number) {}
  now(): Date {
    return new Date(this.time);
  }
  set(iso: string): void {
    this.time = Date.parse(iso);
  }
  advance(ms: number): void {
    this.time += ms;
  }
}

/** Schedules in memory (copies in and out, newest MAX_RESULTS results kept, as the file repository). */
export class MemoryScheduleRepository implements ScheduleRepository {
  readonly records = new Map<string, ScheduleRecord>();
  saves = 0;

  async list(): Promise<ScheduleRecord[]> {
    return [...this.records.values()].map((r) => structuredClone(r)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async get(id: string): Promise<ScheduleRecord | undefined> {
    const record = this.records.get(id);
    return record && structuredClone(record);
  }
  async save(record: ScheduleRecord): Promise<void> {
    this.saves++;
    this.records.set(record.id, structuredClone({ ...record, results: record.results.slice(0, MAX_RESULTS) }));
  }
  async delete(id: string): Promise<boolean> {
    return this.records.delete(id);
  }
}

interface FakeTask {
  status: ScheduledTaskStatus;
  result: ScheduledTaskResult;
}

/** ScheduledTasks in memory: start gives T-1, T-2, ...; `end` finishes a task and announces it. */
export class FakeScheduledTasks implements ScheduledTasks {
  readonly starts: ScheduledTaskStart[] = [];
  readonly tasks = new Map<string, FakeTask & { scheduleId: string }>();
  readonly endSubject = new Subject<ScheduledTaskEnd>();
  readonly ends = this.endSubject.asObservable();
  /** When set, start throws it. */
  refuse?: Error;
  /** When set, start waits for it. */
  gate?: Promise<void>;
  private next = 1;

  async start(input: ScheduledTaskStart): Promise<ScheduledTaskStarted> {
    this.starts.push(input);
    if (this.gate) await this.gate;
    if (this.refuse) throw this.refuse;
    const taskId = `T-${this.next++}`;
    this.tasks.set(taskId, {
      scheduleId: input.scheduleId,
      status: { taskId, state: 'running', ended: false },
      result: { state: 'running', summary: null, lastMessage: null },
    });
    return { taskId, branch: `agentic/${taskId}` };
  }

  async get(taskId: string): Promise<ScheduledTaskStatus | undefined> {
    return this.tasks.get(taskId)?.status;
  }

  async readResult(taskId: string): Promise<ScheduledTaskResult | undefined> {
    return this.tasks.get(taskId)?.result;
  }

  /** Marks the task ended with this result (without announcing it). */
  finish(taskId: string, result: ScheduledTaskResult): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`no task ${taskId}`);
    task.status = { taskId, state: result.state, ...(result.reason !== undefined && { reason: result.reason }), ended: true };
    task.result = result;
  }

  /** Ends the task and announces it on `ends`. */
  end(taskId: string, result: ScheduledTaskResult): void {
    this.finish(taskId, result);
    const task = this.tasks.get(taskId)!;
    this.endSubject.next({ taskId, scheduleId: task.scheduleId, state: result.state, ...(result.reason !== undefined && { reason: result.reason }) });
  }

  /** Adds a task as if started before (e.g. before a restart). */
  add(taskId: string, scheduleId: string, status: Omit<ScheduledTaskStatus, 'taskId'>, result?: ScheduledTaskResult): void {
    this.tasks.set(taskId, {
      scheduleId, status: { taskId, ...status },
      result: result ?? { state: status.state, summary: null, lastMessage: null },
    });
  }
}

export const capRefusal = () => new ScheduledTaskRefusedError('cap', 'At most 2 tasks can run at once');
