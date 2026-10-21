import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GENERATION_ID, WorkflowGeneration } from '../service/generator/workflow-generation';
import type { WorkflowGenerationRepository } from '../service/generator/workflow-generation.repository';

/** One mode-600 JSON file `<id>.json` per generation in a directory (`generations` in WORKFLOWS_DATA_DIR). */
export class WorkflowGenerationFileRepository implements WorkflowGenerationRepository {
  private readonly logger = new Logger(WorkflowGenerationFileRepository.name);

  constructor(private readonly dir: string) {}

  async list(): Promise<WorkflowGeneration[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const all: WorkflowGeneration[] = [];
    for (const name of names) {
      const match = /^(.+)\.json$/.exec(name);
      if (!match || !GENERATION_ID.test(match[1])) continue;
      try {
        const g = await this.get(match[1]);
        if (g) all.push(g);
      } catch (error) {
        // One bad file must not hide the others.
        this.logger.warn(`Skipping unreadable workflow generation file ${name}: ${error instanceof Error ? error.name : 'error'}`);
      }
    }
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<WorkflowGeneration | undefined> {
    if (!GENERATION_ID.test(id)) return undefined;
    try {
      return JSON.parse(await readFile(this.file(id), 'utf8')) as WorkflowGeneration;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  // Temp file in the same directory, then rename: readers see the old or the new one, never half of one.
  async save(generation: WorkflowGeneration): Promise<void> {
    const file = this.file(generation.id);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(generation, null, 2), { mode: 0o600 });
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await rm(this.file(id), { force: true });
  }

  private file(id: string): string {
    if (!GENERATION_ID.test(id)) throw new Error('Invalid generation id');
    return join(this.dir, `${id}.json`);
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
