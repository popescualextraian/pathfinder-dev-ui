import { Inject, Injectable, Logger } from '@nestjs/common';
import { TaskRecord, TaskRecordRepository } from '../../repository/task-record.repository';
import { TASK_LAUNCHER, TaskLauncher } from '../task-launcher';
import { TaskView, toView, viewsDiffer } from '../task-view';
import { COST_RECHECKS, summarizeLedger } from './task-cost';

// Reads the cost ledger of a task's container into its record. Best effort: a failed or empty read
// is logged and the stored cost stays; never throws. Announcing a changed view is the caller's job.
@Injectable()
export class TaskCostService {
  private readonly logger = new Logger(TaskCostService.name);

  constructor(
    private readonly records: TaskRecordRepository,
    @Inject(TASK_LAUNCHER) private readonly launcher: TaskLauncher,
  ) {}

  // The patch for a task whose turn just ended: its ledger is re-read for a few poll rounds.
  armRecheck(): Partial<TaskRecord> {
    return { costRecheck: COST_RECHECKS };
  }

  // The new view when the stored cost changed it, else undefined.
  async refresh(record: TaskRecord): Promise<TaskView | undefined> {
    try {
      const text = await this.launcher.readLedger(record.id);
      if (text === undefined) {
        this.logger.debug(`No ledger for ${record.id} yet`);
        return undefined;
      }
      const cost = summarizeLedger(text, record.id, new Date().toISOString());
      if (cost === undefined) {
        this.logger.warn(`No cost for ${record.id}: no valid record in the ledger`);
        return undefined;
      }
      let before: TaskRecord | undefined;
      const updated = await this.records.update(record.id, (current) => {
        before = current;
        const old = current.cost;
        // Keep a newer stored snapshot; skip the write when only readAt would change.
        if (old && (old.snapshotAt > cost.snapshotAt || JSON.stringify({ ...old, readAt: '' }) === JSON.stringify({ ...cost, readAt: '' }))) return undefined;
        return { cost };
      });
      if (before && updated !== before && viewsDiffer(toView(before), toView(updated))) return toView(updated);
    } catch (error) {
      this.logger.warn(`Cost of ${record.id} not read: ${describe(error)}`);
    }
    return undefined;
  }

  // Every open task whose turn ended recently: read its ledger again and count one round off.
  // Returns the views the read changed.
  async recheckDue(): Promise<TaskView[]> {
    const changed: TaskView[] = [];
    for (const record of await this.records.list()) {
      if (record.closed || !(record.costRecheck && record.costRecheck > 0)) continue;
      try {
        const view = await this.refresh(record);
        if (view) changed.push(view);
        await this.records.update(record.id, (c) => ({ costRecheck: Math.max(0, (c.costRecheck ?? 0) - 1) }));
      } catch (error) {
        this.logger.warn(`Cost recheck of ${record.id} failed: ${describe(error)}`);
      }
    }
    return changed;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
