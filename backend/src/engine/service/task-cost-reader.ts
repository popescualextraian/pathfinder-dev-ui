import { Inject, Injectable, Logger } from '@nestjs/common';
import { TaskRecord, TaskRecordRepository } from '../repository/task-record.repository';
import { summarizeLedger } from './task-cost';
import { TASK_LAUNCHER, TaskLauncher } from './task-launcher';
import { TaskUpdates } from './task-updates';
import { toView, viewsDiffer } from './task-view';

// Reads the cost ledger of a task's container into its record. Best effort: a failed or empty read
// is logged and the stored cost stays; never throws.
@Injectable()
export class TaskCostReader {
  private readonly logger = new Logger(TaskCostReader.name);

  constructor(
    private readonly records: TaskRecordRepository,
    @Inject(TASK_LAUNCHER) private readonly launcher: TaskLauncher,
    private readonly updates: TaskUpdates,
  ) {}

  async refresh(record: TaskRecord): Promise<void> {
    try {
      const text = await this.launcher.readLedger(record.id);
      const cost = text === undefined ? undefined : summarizeLedger(text, record.id, new Date().toISOString());
      if (cost === undefined) {
        this.logger.warn(`No cost for ${record.id}: no ledger or no valid record in it`);
        return;
      }
      const updated = await this.records.update(record.id, { cost });
      if (viewsDiffer(toView(record), toView(updated))) this.updates.changed(toView(updated));
    } catch (error) {
      this.logger.warn(`Cost of ${record.id} not read: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}
