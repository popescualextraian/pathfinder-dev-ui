import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowGenerationFileRepository } from '../../../../src/workflow/repository/workflow-generation-file.repository';
import { GENERATION_ID, newGenerationId, WorkflowGeneration } from '../../../../src/workflow/service/generator/workflow-generation';

const gen = (id: string, createdAt: string): WorkflowGeneration => ({
  id, taskId: 'T-20261021-abcd', description: 'Plan then do', state: 'writing', attempts: 0, turn: { status: 'running' },
  createdAt, updatedAt: createdAt,
});

describe('WorkflowGenerationFileRepository', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wfg-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('new ids are random and match the id pattern', () => {
    const a = newGenerationId();
    expect(a).toMatch(GENERATION_ID);
    expect(newGenerationId()).not.toEqual(a);
  });

  it('saves one mode-600 file per generation in a mode-700 folder and reads it back', async () => {
    const repo = new WorkflowGenerationFileRepository(join(dir, 'generations'));
    const g = gen(newGenerationId(), '2026-10-21T10:00:00.000Z');
    await repo.save(g);
    expect(statSync(join(dir, 'generations')).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'generations', `${g.id}.json`)).mode & 0o777).toBe(0o600);
    expect(await repo.get(g.id)).toEqual(g);
    await repo.save({ ...g, state: 'ready' });
    expect((await repo.get(g.id))?.state).toBe('ready');
    expect(readdirSync(join(dir, 'generations'))).toEqual([`${g.id}.json`]);
  });

  it('lists oldest first, skipping other and unreadable files; empty when the folder is missing', async () => {
    expect(await new WorkflowGenerationFileRepository(join(dir, 'nope')).list()).toEqual([]);
    const repo = new WorkflowGenerationFileRepository(dir);
    await repo.save(gen('G-20261021-bbbbbbbb', '2026-10-21T11:00:00.000Z'));
    await repo.save(gen('G-20261021-aaaaaaaa', '2026-10-21T10:00:00.000Z'));
    writeFileSync(join(dir, 'R-20261021-aaaaaaaa.json'), '{}');
    writeFileSync(join(dir, 'G-20261021-cccccccc.json'), 'not json');
    expect((await repo.list()).map((g) => g.id)).toEqual(['G-20261021-aaaaaaaa', 'G-20261021-bbbbbbbb']);
  });

  it('deletes a generation; deleting a missing one is fine', async () => {
    const repo = new WorkflowGenerationFileRepository(dir);
    const g = gen('G-20261021-aaaaaaaa', '2026-10-21T10:00:00.000Z');
    await repo.save(g);
    await repo.delete(g.id);
    expect(await repo.get(g.id)).toBeUndefined();
    await expect(repo.delete(g.id)).resolves.toBeUndefined();
  });

  it('refuses ids that are not generation ids', async () => {
    const repo = new WorkflowGenerationFileRepository(dir);
    expect(await repo.get('../x')).toBeUndefined();
    await expect(repo.save(gen('../x', '2026-10-21T10:00:00.000Z'))).rejects.toThrow('Invalid generation id');
    await expect(repo.delete('../x')).rejects.toThrow('Invalid generation id');
  });
});
