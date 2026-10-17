import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineConfig } from '../../../../src/commons/engine-config';
import { TaskRecord, TaskRecordRepository } from '../../../../src/repository/tasks/task-record.repository';

function record(id: string, extra: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    prompt: 'do it',
    repoUrl: 'https://github.com/example/repo.git',
    branch: `agentic/${id}`,
    containerName: `agentic-ui-task-${id}`,
    taskToken: 'made-up-task-token-aaaaaaaa',
    agentToken: 'made-up-agent-token-bbbbbbb',
    createdAt: '2026-10-16T10:00:00.000Z',
    updatedAt: '2026-10-16T10:00:00.000Z',
    ...extra,
  };
}

describe('TaskRecordRepository', () => {
  let root: string;
  let dataDir: string;
  let repo: TaskRecordRepository;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'task-records-'));
    dataDir = join(root, 'data');
    repo = new TaskRecordRepository({ dataDir } as EngineConfig);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('creates and gets a record, with a 0700 directory and a 0600 file', async () => {
    const r = record('T-20261016-ab12');
    await repo.create(r);
    expect(await repo.get(r.id)).toEqual(r);
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dataDir, `${r.id}.json`)).mode & 0o777).toBe(0o600);
  });

  it('leaves no temp files behind', async () => {
    await repo.create(record('T-20261016-ab12'));
    await repo.update('T-20261016-ab12', { lastState: 'idle' });
    expect(readdirSync(dataDir)).toEqual(['T-20261016-ab12.json']);
  });

  it('returns undefined for a missing record, also before the directory exists', async () => {
    expect(await repo.get('T-20261016-zz99')).toBeUndefined();
    expect(await repo.list()).toEqual([]);
  });

  it('refuses to create a record that already exists', async () => {
    await repo.create(record('T-20261016-ab12'));
    await expect(repo.create(record('T-20261016-ab12'))).rejects.toThrow('already exists');
  });

  it('lists records ordered by createdAt and ignores other files', async () => {
    await repo.create(record('T-20261016-bbbb', { createdAt: '2026-10-16T11:00:00.000Z' }));
    await repo.create(record('T-20261016-aaaa', { createdAt: '2026-10-16T09:00:00.000Z' }));
    writeFileSync(join(dataDir, 'notes.txt'), 'x');
    expect((await repo.list()).map((r) => r.id)).toEqual(['T-20261016-aaaa', 'T-20261016-bbbb']);
  });

  it('merges a partial update, keeps the id and bumps updatedAt', async () => {
    const r = record('T-20261016-ab12');
    await repo.create(r);
    const updated = await repo.update(r.id, { lastState: 'idle', bridgeUrl: 'http://x:8765', id: 'T-20261016-evil' } as Partial<TaskRecord>);
    expect(updated).toMatchObject({ id: r.id, prompt: 'do it', lastState: 'idle', bridgeUrl: 'http://x:8765' });
    expect(updated.updatedAt).not.toBe(r.updatedAt);
    expect(await repo.get(r.id)).toEqual(updated);
  });

  it('computes a patch from the record as it is when the write happens, and may decline', async () => {
    const r = record('T-20261016-fn01');
    await repo.create(r);
    const slow = repo.update(r.id, { lastState: 'running' });
    const fn = repo.update(r.id, (current) => ({ lastMessage: `seen ${current.lastState}` }));
    await slow;
    expect((await fn).lastMessage).toBe('seen running');
    const untouched = await repo.update(r.id, () => undefined);
    expect(untouched.updatedAt).toBe((await fn).updatedAt);
  });

  it('throws when updating a missing record', async () => {
    await expect(repo.update('T-20261016-zz99', { lastState: 'idle' })).rejects.toThrow('not found');
  });

  it('deletes a record and tolerates deleting a missing one', async () => {
    await repo.create(record('T-20261016-ab12'));
    await repo.delete('T-20261016-ab12');
    expect(await repo.get('T-20261016-ab12')).toBeUndefined();
    await expect(repo.delete('T-20261016-ab12')).resolves.toBeUndefined();
  });

  it.each(['../etc/passwd', 'T-20261016-AB12', 'T-2026101-ab12', 'T-20261016-ab123', 'T-20261016-ab12/../x', '', 'T-20261016-ab1\n'])(
    'rejects id %j without touching the disk',
    async (id) => {
      await expect(repo.get(id)).rejects.toThrow('Invalid task id');
      await expect(repo.create(record(id))).rejects.toThrow('Invalid task id');
      await expect(repo.update(id, {})).rejects.toThrow('Invalid task id');
      await expect(repo.delete(id)).rejects.toThrow('Invalid task id');
    },
  );

  it('survives many concurrent updates of the same record without losing any field', async () => {
    const id = 'T-20261016-ab12';
    await repo.create(record(id));
    await Promise.all(Array.from({ length: 30 }, (_, n) => repo.update(id, { [`f${n}`]: n } as Partial<TaskRecord>)));
    const stored = (await repo.get(id)) as unknown as Record<string, number>;
    for (let n = 0; n < 30; n++) expect(stored[`f${n}`]).toBe(n);
    expect(readdirSync(dataDir)).toEqual([`${id}.json`]);
  });
});
