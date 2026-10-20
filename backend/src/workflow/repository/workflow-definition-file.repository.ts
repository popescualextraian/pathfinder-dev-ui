import { createHash, randomBytes } from 'node:crypto';
import { access, constants, link, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';
import { parseWorkflowDefinition, validateWorkflowDefinition, WORKFLOW_ID } from '../service/parse-workflow';
import { serializeWorkflowDefinition } from '../service/serialize-workflow';
import type { WorkflowDefinition, WorkflowDefinitions } from '../service/workflow-definition';
import type { StoredWorkflow, WorkflowDefinitionRepository } from '../service/workflow-definition.repository';
import { WorkflowConflictError, WorkflowInvalidError, WorkflowNotFoundError, WorkflowReadOnlyError } from '../service/workflow-errors';
import type { WorkItems } from '../service/work-items';

export interface WorkflowDefinitionFileOptions {
  /** Rejects when the folder cannot be written; replaceable in tests (root ignores file modes). */
  access?: (dir: string) => Promise<void>;
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const isYaml = (n: string): boolean => ['.yaml', '.yml'].includes(extname(n));
const code = (e: unknown): string | undefined => (e as NodeJS.ErrnoException).code;

/**
 * One definition per *.yaml / *.yml file of a directory, read on every call; writes are atomic (temp file in the same
 * folder, then rename; create uses a hard link so it never overwrites). The version is the hash of the file content.
 * A check-then-rename race with another writer of the same file is possible; the window is a few microseconds.
 */
export class WorkflowDefinitionFileRepository implements WorkflowDefinitionRepository {
  private readonly canWrite: (dir: string) => Promise<void>;

  constructor(
    private readonly dir: string,
    private readonly items?: Pick<WorkItems, 'stages'> & Partial<WorkItems>,
    options: WorkflowDefinitionFileOptions = {},
  ) {
    this.canWrite = options.access ?? (((d: string) => access(d, constants.W_OK | constants.X_OK)));
  }

  async list(): Promise<WorkflowDefinitions> {
    const result: WorkflowDefinitions = { definitions: [], refused: [] };
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter(isYaml).sort();
    } catch (e) {
      if (code(e) === 'ENOENT') return result;
      throw e;
    }
    const stages = this.items?.stages ? await this.items.stages() : undefined;
    const files = new Map<string, string>(); // id -> the file that has it
    for (const file of names) {
      const id = basename(file, extname(file));
      const earlier = files.get(id);
      let text: string | undefined;
      try {
        text = await readFile(join(this.dir, file), 'utf8');
      } catch (e) {
        result.refused.push({ file, error: `${file}: ${(e as Error).message}` });
        continue;
      }
      const version = hash(text);
      if (earlier !== undefined) {
        result.refused.push({ file, error: `${file}: duplicate workflow id "${id}" (also ${earlier})`, version });
        continue;
      }
      files.set(id, file);
      try {
        result.definitions.push(parseWorkflowDefinition(id, text, { stages }));
      } catch (e) {
        result.refused.push({ file, error: `${file}: ${(e as Error).message}`, version });
      }
    }
    return result;
  }

  async get(id: string): Promise<WorkflowDefinition | undefined> {
    return (await this.list()).definitions.find((d) => d.id === id);
  }

  async read(id: string): Promise<StoredWorkflow> {
    const found = await this.find(id);
    if (found) {
      try {
        const stages = this.items?.stages ? await this.items.stages() : undefined;
        return { definition: parseWorkflowDefinition(id, found.text, { stages }), version: hash(found.text) };
      } catch { /* refused: not a definition */ }
    }
    throw new WorkflowNotFoundError('Workflow not found');
  }

  async save(id: string, definition: WorkflowDefinition, expectedVersion?: string): Promise<StoredWorkflow> {
    if (!WORKFLOW_ID.test(id)) throw new WorkflowInvalidError(`The workflow id must match ${WORKFLOW_ID}`);
    await this.requireWritable();
    const stages = this.items?.stages ? await this.items.stages() : undefined;
    const valid = validateWorkflowDefinition(id, definition, { stages });
    const text = serializeWorkflowDefinition(valid);
    const target = join(this.dir, `${id}.yaml`);
    const existing = await this.find(id);
    if (expectedVersion === undefined) {
      if (existing) throw new WorkflowConflictError(`A workflow "${id}" exists already`);
    } else {
      if (!existing) throw new WorkflowNotFoundError('Workflow not found');
      if (hash(existing.text) !== expectedVersion) throw new WorkflowConflictError('The workflow was changed by someone else');
    }
    const temp = join(this.dir, `.${id}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await writeFile(temp, text, { mode: 0o644, flag: 'wx' });
      if (existing) {
        await rename(temp, target);
        if (existing.file !== `${id}.yaml`) await unlink(join(this.dir, existing.file));
      } else {
        await link(temp, target); // fails when the file appeared meanwhile
      }
    } catch (e) {
      if (code(e) === 'EEXIST') throw new WorkflowConflictError(`A workflow "${id}" exists already`);
      throw this.mapWrite(e);
    } finally {
      await unlink(temp).catch(() => undefined);
    }
    return { definition: valid, version: hash(text) };
  }

  async delete(id: string, expectedVersion: string): Promise<void> {
    const found = await this.find(id);
    if (!found) throw new WorkflowNotFoundError('Workflow not found');
    await this.remove(found.file, found.text, expectedVersion);
  }

  async deleteRefused(file: string, expectedVersion: string): Promise<void> {
    const entry = (await this.list()).refused.find((r) => r.file === file);
    if (!entry) throw new WorkflowNotFoundError('Workflow file not found');
    let text: string;
    try {
      text = await readFile(join(this.dir, entry.file), 'utf8');
    } catch (e) {
      throw code(e) === 'ENOENT' ? new WorkflowNotFoundError('Workflow file not found') : e;
    }
    await this.remove(entry.file, text, expectedVersion);
  }

  async writable(): Promise<boolean> {
    try {
      await this.canWrite(this.dir);
      return true;
    } catch {
      return false;
    }
  }

  private async remove(file: string, text: string, expectedVersion: string): Promise<void> {
    await this.requireWritable();
    if (hash(text) !== expectedVersion) throw new WorkflowConflictError('The workflow was changed by someone else');
    try {
      await unlink(join(this.dir, file));
    } catch (e) {
      throw code(e) === 'ENOENT' ? new WorkflowNotFoundError('Workflow file not found') : this.mapWrite(e);
    }
  }

  /** The file that holds an id: <id>.yaml, else <id>.yml. */
  private async find(id: string): Promise<{ file: string; text: string } | undefined> {
    if (!WORKFLOW_ID.test(id)) return undefined;
    for (const file of [`${id}.yaml`, `${id}.yml`]) {
      try {
        return { file, text: await readFile(join(this.dir, file), 'utf8') };
      } catch (e) {
        if (!['ENOENT', 'EISDIR'].includes(code(e) ?? '')) throw e;
      }
    }
    return undefined;
  }

  private async requireWritable(): Promise<void> {
    if (!(await this.writable())) throw new WorkflowReadOnlyError();
  }

  private mapWrite(e: unknown): unknown {
    return ['EACCES', 'EPERM', 'EROFS'].includes(code(e) ?? '') ? new WorkflowReadOnlyError() : e;
  }
}
