import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ENGINE_CONFIG, EngineConfig } from '../../commons/engine-config';

// The only place the per-task tokens are stored. They never leave the backend.
export interface TaskRecord {
  id: string;
  prompt: string;
  repoUrl: string;
  repoRef?: string;
  model?: string;
  branch: string;
  containerName: string;
  bridgeUrl?: string;
  taskToken: string;
  agentToken: string;
  createdAt: string;
  updatedAt: string;
  // Last state seen from the bridge, for listing without asking every bridge.
  lastState?: string;
  lastStatus?: unknown;
}

const ID = /^T-\d{8}-[a-z0-9]{4}$/;

@Injectable()
export class TaskRecordRepository {
  private readonly dir: string;
  // Per id: the tail of the queue of read-modify-write updates, so none of them is lost.
  private readonly updates = new Map<string, Promise<unknown>>();

  constructor(@Inject(ENGINE_CONFIG) config: Pick<EngineConfig, 'dataDir'>) {
    this.dir = config.dataDir;
  }

  async create(record: TaskRecord): Promise<TaskRecord> {
    if (await this.get(record.id)) throw new Error(`Task record ${record.id} already exists`);
    await this.write(record);
    return record;
  }

  async get(id: string): Promise<TaskRecord | undefined> {
    const file = this.file(id);
    try {
      return JSON.parse(await readFile(file, 'utf8')) as TaskRecord;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async list(): Promise<TaskRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const records: TaskRecord[] = [];
    for (const name of names) {
      const match = /^(.+)\.json$/.exec(name);
      if (!match || !ID.test(match[1])) continue;
      const record = await this.get(match[1]);
      if (record) records.push(record);
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  update(id: string, patch: Partial<TaskRecord>): Promise<TaskRecord> {
    const previous = this.updates.get(id) ?? Promise.resolve();
    const run = previous.then(() => this.doUpdate(id, patch));
    const tail = run.catch(() => undefined);
    this.updates.set(id, tail);
    void tail.then(() => { if (this.updates.get(id) === tail) this.updates.delete(id); });
    return run;
  }

  private async doUpdate(id: string, patch: Partial<TaskRecord>): Promise<TaskRecord> {
    const current = await this.get(id);
    if (!current) throw new Error(`Task record ${id} not found`);
    const updated = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
    await this.write(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await rm(this.file(id), { force: true });
  }

  private file(id: string): string {
    if (!ID.test(id)) throw new Error('Invalid task id');
    return join(this.dir, `${id}.json`);
  }

  // Temp file in the same directory, then rename: readers see the old or the new record, never half of one.
  private async write(record: TaskRecord): Promise<void> {
    const file = this.file(record.id);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(record, null, 2), { mode: 0o600 });
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
