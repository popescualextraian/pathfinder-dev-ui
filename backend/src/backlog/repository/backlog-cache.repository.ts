import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKLOG_CONFIG, BacklogConfig } from '../service/backlog-config';
import { Item } from '../service/backlog-connector';
import { BacklogStore } from '../service/backlog-store';

// The backlog cache: one mode-600 JSON file with the last snapshot of the items.
@Injectable()
export class BacklogCacheRepository implements BacklogStore {
  private readonly file: string;
  private readonly dir: string;
  // Tail of the queue of writes: the file always ends with the last snapshot submitted.
  private tail: Promise<unknown> = Promise.resolve();

  constructor(@Inject(BACKLOG_CONFIG) config: Pick<BacklogConfig, 'dataDir'>) {
    this.dir = config.dataDir;
    this.file = join(config.dataDir, 'backlog.json');
  }

  // A missing, corrupt or unexpected file is an empty cache: the next refresh rebuilds it.
  async load(): Promise<Item[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      return Array.isArray(parsed) ? (parsed as Item[]) : [];
    } catch {
      return [];
    }
  }

  save(items: Item[]): Promise<void> {
    const run = this.tail.then(() => this.write(items));
    this.tail = run.catch(() => undefined);
    return run;
  }

  // Temp file in the same directory, then rename: readers see the old or the new file, never half of one.
  private async write(items: Item[]): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(items, null, 2), { mode: 0o600 });
      await rename(temp, this.file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }
}
