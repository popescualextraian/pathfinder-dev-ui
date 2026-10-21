import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowDefinitionFileRepository } from '../../../../src/workflow/repository/workflow-definition-file.repository';
import { WorkflowDefinitionError } from '../../../../src/workflow/service/parse-workflow';
import type { WorkflowDefinition } from '../../../../src/workflow/service/workflow-definition';
import { WorkflowConflictError, WorkflowInvalidError, WorkflowNotFoundError, WorkflowReadOnlyError } from '../../../../src/workflow/service/workflow-errors';

const def = (title = 'One', o: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  id: 'one', title, steps: [{ id: 'a', title: 'A', gate: 'auto', prompt: 'hi {{item.id}}' }], ...o,
});
const OLD = 'title: Old\nsteps:\n  - id: a\n    title: A\n    gate: auto\n    prompt: hi\n';

describe('WorkflowDefinitionFileRepository write side', () => {
  let dir: string;
  let repo: WorkflowDefinitionFileRepository;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wf-w-')); repo = new WorkflowDefinitionFileRepository(dir); });
  afterEach(() => { chmodSync(dir, 0o755); rmSync(dir, { recursive: true, force: true }); });

  it('creates <id>.yaml, reads it back with a version, leaves no temp file', async () => {
    const saved = await repo.save('one', def());
    expect(readdirSync(dir)).toEqual(['one.yaml']);
    expect(await repo.read('one')).toEqual(saved);
    expect(saved.definition).toEqual(def());
    expect(saved.version).toMatch(/^[0-9a-f]{64}$/);
    expect((await repo.list()).definitions).toEqual([def()]);
  });

  it('the version changes with the content and not without', async () => {
    const a = await repo.save('one', def('A'));
    const b = await repo.save('one', def('B'), a.version);
    expect(b.version).not.toBe(a.version);
    expect((await repo.read('one')).version).toBe(b.version);
    expect((await repo.read('one')).definition.title).toBe('B');
  });

  it('create conflicts when the id exists (also as .yml)', async () => {
    await repo.save('one', def());
    await expect(repo.save('one', def('X'))).rejects.toBeInstanceOf(WorkflowConflictError);
    writeFileSync(join(dir, 'two.yml'), OLD);
    await expect(repo.save('two', def('X', { id: 'two' }))).rejects.toBeInstanceOf(WorkflowConflictError);
    expect(readFileSync(join(dir, 'two.yml'), 'utf8')).toBe(OLD);
  });

  it('update conflicts when the file changed, is NotFound when gone', async () => {
    const a = await repo.save('one', def('A'));
    writeFileSync(join(dir, 'one.yaml'), OLD);
    await expect(repo.save('one', def('B'), a.version)).rejects.toBeInstanceOf(WorkflowConflictError);
    expect(readFileSync(join(dir, 'one.yaml'), 'utf8')).toBe(OLD);
    await expect(repo.save('nope', def('B', { id: 'nope' }), 'x')).rejects.toBeInstanceOf(WorkflowNotFoundError);
  });

  it('saving a workflow loaded from .yml writes .yaml and removes the .yml', async () => {
    writeFileSync(join(dir, 'one.yml'), OLD);
    const { version, definition } = await repo.read('one');
    expect(definition.title).toBe('Old');
    await repo.save('one', def('New'), version);
    expect(readdirSync(dir)).toEqual(['one.yaml']);
    expect((await repo.read('one')).definition.title).toBe('New');
  });

  it('validates before writing: first error with its location, nothing written', async () => {
    const bad = def('T', { steps: [{ id: 'a', title: 'A', gate: 'auto', prompt: 'p', fork: 'zz' }] });
    await expect(repo.save('one', bad)).rejects.toMatchObject({ location: { stepId: 'a', field: 'fork' } });
    await expect(repo.save('one', bad)).rejects.toBeInstanceOf(WorkflowDefinitionError);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('checks stages against the work items', async () => {
    const r = new WorkflowDefinitionFileRepository(dir, { stages: async () => ['plan'] });
    await expect(r.save('one', def('T', { doneStage: 'nope' }))).rejects.toMatchObject({ location: { field: 'doneStage' } });
    await r.save('one', def('T', { doneStage: 'plan' }));
  });

  it('refuses the reserved id "new" with a clear message', async () => {
    await expect(repo.save('new', def())).rejects.toThrow(/"new" is reserved/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('two concurrent updates with the same version: one succeeds, the other conflicts', async () => {
    const a = await repo.save('one', def('A'));
    const results = await Promise.allSettled([repo.save('one', def('B'), a.version), repo.save('one', def('C'), a.version)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(WorkflowConflictError);
  });

  it('two concurrent deletes with the same version: one succeeds, the other is not found or conflicts', async () => {
    const a = await repo.save('one', def('A'));
    const results = await Promise.allSettled([repo.delete('one', a.version), repo.delete('one', a.version)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it.each(['', 'A', '../x', 'a/b', '.hidden', 'a.b', '-a', 'a'.repeat(65)])('refuses the id %j', async (id) => {
    await expect(repo.save(id, def())).rejects.toBeInstanceOf(WorkflowInvalidError);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('read of an unknown, invalid or refused id is NotFound', async () => {
    writeFileSync(join(dir, 'bad.yaml'), 'title: [oops');
    for (const id of ['missing', '../etc', 'bad']) await expect(repo.read(id)).rejects.toBeInstanceOf(WorkflowNotFoundError);
  });

  it('deletes with the version; conflict when changed; NotFound when gone', async () => {
    const a = await repo.save('one', def());
    await expect(repo.delete('one', 'stale')).rejects.toBeInstanceOf(WorkflowConflictError);
    expect(existsSync(join(dir, 'one.yaml'))).toBe(true);
    await repo.delete('one', a.version);
    expect(readdirSync(dir)).toEqual([]);
    await expect(repo.delete('one', a.version)).rejects.toBeInstanceOf(WorkflowNotFoundError);
    await expect(repo.delete('../one', a.version)).rejects.toBeInstanceOf(WorkflowNotFoundError);
  });

  it('refused entries carry a version; deleteRefused deletes by file name from the listing', async () => {
    writeFileSync(join(dir, 'bad.yaml'), 'title: [oops');
    writeFileSync(join(dir, 'other.txt'), 'x');
    const { refused } = await repo.list();
    expect(refused).toHaveLength(1);
    expect(refused[0].version).toMatch(/^[0-9a-f]{64}$/);
    await expect(repo.deleteRefused('bad.yaml', 'stale')).rejects.toBeInstanceOf(WorkflowConflictError);
    await repo.deleteRefused('bad.yaml', refused[0].version!);
    expect(readdirSync(dir)).toEqual(['other.txt']);
  });

  it('deleteRefused refuses names not in the refused listing: good files, paths, other files', async () => {
    const a = await repo.save('one', def());
    writeFileSync(join(dir, 'other.txt'), 'x');
    writeFileSync(join(dir, 'bad.yaml'), 'title: [oops');
    for (const f of ['one.yaml', 'other.txt', '../bad.yaml', join(dir, 'bad.yaml'), 'missing.yaml', 'bad.yaml/']) {
      await expect(repo.deleteRefused(f, a.version)).rejects.toBeInstanceOf(WorkflowNotFoundError);
    }
    expect(readdirSync(dir).sort()).toEqual(['bad.yaml', 'one.yaml', 'other.txt']);
  });

  it('deletes a refused duplicate .yml by name', async () => {
    await repo.save('one', def());
    writeFileSync(join(dir, 'one.yml'), OLD);
    const { refused } = await repo.list();
    await repo.deleteRefused('one.yml', refused[0].version!);
    expect(readdirSync(dir)).toEqual(['one.yaml']);
  });

  it('writable reflects the access check; writes then throw ReadOnly and change nothing', async () => {
    const a = await repo.save('one', def());
    const ro = new WorkflowDefinitionFileRepository(dir, undefined, { access: async () => { throw Object.assign(new Error('ro'), { code: 'EROFS' }); } });
    expect(await ro.writable()).toBe(false);
    await expect(ro.save('two', def('X', { id: 'two' }))).rejects.toBeInstanceOf(WorkflowReadOnlyError);
    await expect(ro.save('one', def('X'), a.version)).rejects.toBeInstanceOf(WorkflowReadOnlyError);
    await expect(ro.delete('one', a.version)).rejects.toBeInstanceOf(WorkflowReadOnlyError);
    expect(readdirSync(dir)).toEqual(['one.yaml']);
    expect((await ro.read('one')).version).toBe(a.version);
  });

  it('writable is true for a writable folder and false for a missing one', async () => {
    expect(await repo.writable()).toBe(true);
    expect(await new WorkflowDefinitionFileRepository(join(dir, 'nope')).writable()).toBe(false);
  });

  const asRoot = process.getuid?.() === 0;
  (asRoot ? it.skip : it)('a real read-only folder: writable false, save throws ReadOnly', async () => {
    chmodSync(dir, 0o555);
    expect(await repo.writable()).toBe(false);
    await expect(repo.save('one', def())).rejects.toBeInstanceOf(WorkflowReadOnlyError);
  });
});
