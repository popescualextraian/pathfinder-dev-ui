import { readdir, readFile } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';
import { parseWorkflowDefinition } from '../service/parse-workflow';
import type { WorkflowDefinition, WorkflowDefinitions } from '../service/workflow-definition';
import type { WorkflowDefinitionRepository } from '../service/workflow-definition.repository';
import type { WorkItems } from '../service/work-items';

/** Reads one definition per *.yaml / *.yml file of a directory, on every call. */
export class WorkflowDefinitionFileRepository implements WorkflowDefinitionRepository {
  constructor(private readonly dir: string, private readonly items?: Pick<WorkItems, 'stages'> & Partial<WorkItems>) {}

  async list(): Promise<WorkflowDefinitions> {
    const result: WorkflowDefinitions = { definitions: [], refused: [] };
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => ['.yaml', '.yml'].includes(extname(n))).sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return result;
      throw e;
    }
    const stages = this.items?.stages ? await this.items.stages() : undefined;
    const files = new Map<string, string>(); // id -> the file that has it
    for (const file of names) {
      const id = basename(file, extname(file));
      const earlier = files.get(id);
      if (earlier !== undefined) {
        result.refused.push({ file, error: `${file}: duplicate workflow id "${id}" (also ${earlier})` });
        continue;
      }
      files.set(id, file);
      try {
        const text = await readFile(join(this.dir, file), 'utf8');
        result.definitions.push(parseWorkflowDefinition(basename(file, extname(file)), text, { stages }));
      } catch (e) {
        result.refused.push({ file, error: `${file}: ${(e as Error).message}` });
      }
    }
    return result;
  }

  async get(id: string): Promise<WorkflowDefinition | undefined> {
    return (await this.list()).definitions.find((d) => d.id === id);
  }
}
