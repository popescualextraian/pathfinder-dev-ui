import { Logger } from '@nestjs/common';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SCHEDULE_ID } from '../service/schedule-id';
import type { ScheduleRecord } from '../service/schedule';
import type { ScheduleRepository } from '../service/schedule.repository';

/** Results kept per schedule (newest first). */
export const MAX_RESULTS = 50;

/** One mode-600 JSON file `<id>.json` per schedule, with its results, in a directory (SCHEDULES_DATA_DIR). */
export class ScheduleFileRepository implements ScheduleRepository {
  private readonly logger = new Logger(ScheduleFileRepository.name);

  constructor(private readonly dir: string) {}

  async list(): Promise<ScheduleRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const records: ScheduleRecord[] = [];
    for (const name of names) {
      const match = /^(.+)\.json$/.exec(name);
      if (!match || !SCHEDULE_ID.test(match[1])) continue;
      try {
        const record = await this.get(match[1]);
        if (record) records.push(record);
      } catch (error) {
        // One bad file must not hide the other schedules.
        this.logger.warn(`Skipping unreadable schedule file ${name}: ${error instanceof Error ? error.name : 'error'}`);
      }
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<ScheduleRecord | undefined> {
    if (!SCHEDULE_ID.test(id)) return undefined;
    try {
      return JSON.parse(await readFile(this.file(id), 'utf8')) as ScheduleRecord;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  // Temp file in the same directory, then rename: readers see the old or the new file, never half of one.
  async save(record: ScheduleRecord): Promise<void> {
    const file = this.file(record.id);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const kept = { ...record, results: record.results.slice(0, MAX_RESULTS) };
    try {
      await writeFile(temp, JSON.stringify(kept, null, 2), { mode: 0o600 });
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!SCHEDULE_ID.test(id)) return false;
    try {
      await rm(this.file(id));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  private file(id: string): string {
    if (!SCHEDULE_ID.test(id)) throw new Error('Invalid schedule id');
    return join(this.dir, `${id}.json`);
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
