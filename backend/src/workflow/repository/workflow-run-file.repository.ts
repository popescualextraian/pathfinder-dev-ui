import { Logger } from '@nestjs/common';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { RUN_ID, WorkflowRun } from '../service/workflow-run';
import type { WorkflowRunRepository } from '../service/workflow-run.repository';

/** One mode-600 JSON file `<id>.json` per run in a directory (WORKFLOWS_DATA_DIR). */
export class WorkflowRunFileRepository implements WorkflowRunRepository {
  private readonly logger = new Logger(WorkflowRunFileRepository.name);

  constructor(private readonly dir: string) {}

  async list(): Promise<WorkflowRun[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const runs: WorkflowRun[] = [];
    for (const name of names) {
      const match = /^(.+)\.json$/.exec(name);
      if (!match || !RUN_ID.test(match[1])) continue;
      try {
        const run = await this.get(match[1]);
        if (run) runs.push(run);
      } catch (error) {
        // One bad file must not hide the other runs.
        this.logger.warn(`Skipping unreadable workflow run file ${name}: ${error instanceof Error ? error.name : 'error'}`);
      }
    }
    return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<WorkflowRun | undefined> {
    if (!RUN_ID.test(id)) return undefined;
    try {
      return JSON.parse(await readFile(this.file(id), 'utf8')) as WorkflowRun;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  // Temp file in the same directory, then rename: readers see the old or the new run, never half of one.
  async save(run: WorkflowRun): Promise<void> {
    const file = this.file(run.id);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(run, null, 2), { mode: 0o600 });
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  private file(id: string): string {
    if (!RUN_ID.test(id)) throw new Error('Invalid run id');
    return join(this.dir, `${id}.json`);
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
