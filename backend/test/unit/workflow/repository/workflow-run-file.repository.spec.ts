import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowRunFileRepository } from '../../../../src/workflow/repository/workflow-run-file.repository';
import { newRunId, RUN_ID, WorkflowRun } from '../../../../src/workflow/service/workflow-run';

const run = (id: string, createdAt: string): WorkflowRun => ({
  id, workflowId: 'wf', itemId: '7', taskId: 'T-20261020-abcd', stepIndex: 0, phase: 'sessions', state: 'running',
  item: { id: '7', title: 'Seven', description: '', url: 'u', stage: 'todo' },
  definition: { id: 'wf', title: 'WF', steps: [{ id: 's', title: 'S', stage: 'plan', gate: 'auto', prompt: 'p' }] },
  sessions: { main: { status: 'running' } }, createdAt, updatedAt: createdAt,
});

describe('WorkflowRunFileRepository', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wfr-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('new ids are random and match the id pattern', () => {
    const a = newRunId();
    expect(a).toMatch(RUN_ID);
    expect(newRunId()).not.toEqual(a);
  });

  it('saves one mode-600 file per run and reads it back', async () => {
    const repo = new WorkflowRunFileRepository(join(dir, 'runs'));
    const r = run(newRunId(), '2026-10-20T10:00:00.000Z');
    await repo.save(r);
    const file = join(dir, 'runs', `${r.id}.json`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await repo.get(r.id)).toEqual(r);
    await repo.save({ ...r, state: 'done' });
    expect((await repo.get(r.id))?.state).toBe('done');
    expect(readdirSync(join(dir, 'runs'))).toEqual([`${r.id}.json`]);
  });

  it('lists runs oldest first, ignoring other files; empty when the dir is missing', async () => {
    expect(await new WorkflowRunFileRepository(join(dir, 'nope')).list()).toEqual([]);
    const repo = new WorkflowRunFileRepository(dir);
    const late = run('R-20261020-bbbbbbbb', '2026-10-20T11:00:00.000Z');
    const early = run('R-20261020-aaaaaaaa', '2026-10-20T09:00:00.000Z');
    await repo.save(late);
    await repo.save(early);
    writeFileSync(join(dir, 'notes.json'), '{}');
    writeFileSync(join(dir, 'x.txt'), 'x');
    expect((await repo.list()).map((r) => r.id)).toEqual([early.id, late.id]);
  });

  it('get of an unknown or unsafe id is undefined; save of an unsafe id throws', async () => {
    const repo = new WorkflowRunFileRepository(dir);
    expect(await repo.get('R-20261020-zzzzzzzz')).toBeUndefined();
    expect(await repo.get('../etc/passwd')).toBeUndefined();
    await expect(repo.save(run('../evil', '2026-10-20T09:00:00.000Z'))).rejects.toThrow(/Invalid run id/);
  });
});

describe('WorkflowRunFileRepository with a corrupt file', () => {
  it('list skips an unreadable run file and still returns the others', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wfr-'));
    try {
      const repo = new WorkflowRunFileRepository(dir);
      const good = run('R-20261020-aaaaaaaa', '2026-10-20T09:00:00.000Z');
      await repo.save(good);
      writeFileSync(join(dir, 'R-20261020-bbbbbbbb.json'), '{ not json');
      expect((await repo.list()).map((r) => r.id)).toEqual([good.id]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
