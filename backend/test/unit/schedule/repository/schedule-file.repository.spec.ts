import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_RESULTS, ScheduleFileRepository } from '../../../../src/schedule/repository/schedule-file.repository';
import type { ScheduleRecord, ScheduleResult } from '../../../../src/schedule/service/schedule';

const result = (n: number): ScheduleResult => ({ firedAt: `2026-01-01T00:${String(n).padStart(2, '0')}:00Z`, trigger: 'time', outcome: 'done' });
const record = (id: string, results: ScheduleResult[] = []): ScheduleRecord => ({
  id, title: id, prompt: 'p', repository: 'app', when: { cron: '0 2 * * *' }, timeoutMinutes: 120, enabled: true,
  nextRunAt: '2026-10-22T02:00:00+03:00', createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', results,
});

describe('ScheduleFileRepository', () => {
  let dir: string;
  let repo: ScheduleFileRepository;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sched-'));
    repo = new ScheduleFileRepository(join(dir, 'schedules'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('lists nothing when the directory does not exist', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('saves and gets a schedule with its results, mode 600, no temp files left', async () => {
    await repo.save(record('a', [result(2), result(1)]));
    expect(await repo.get('a')).toEqual(record('a', [result(2), result(1)]));
    const files = await readdir(join(dir, 'schedules'));
    expect(files).toEqual(['a.json']);
    expect((await stat(join(dir, 'schedules', 'a.json'))).mode & 0o777).toBe(0o600);
  });

  it('keeps the newest 50 results', async () => {
    const results = Array.from({ length: 60 }, (_, i) => result(59 - i));
    await repo.save(record('a', results));
    const saved = (await repo.get('a'))!;
    expect(saved.results).toHaveLength(MAX_RESULTS);
    expect(saved.results[0]).toEqual(result(59));
    expect(saved.results[49]).toEqual(result(10));
  });

  it('lists by creation then id and skips bad files', async () => {
    await repo.save(record('b'));
    await repo.save(record('a'));
    await writeFile(join(dir, 'schedules', 'broken.json'), '{nope');
    await writeFile(join(dir, 'schedules', 'Bad Name.json'), '{}');
    expect((await repo.list()).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('returns undefined for unknown or invalid ids', async () => {
    expect(await repo.get('nope')).toBeUndefined();
    expect(await repo.get('../x')).toBeUndefined();
  });

  it('deletes, reporting whether it existed', async () => {
    await repo.save(record('a'));
    expect(await repo.delete('a')).toBe(true);
    expect(await repo.delete('a')).toBe(false);
    expect(await repo.get('a')).toBeUndefined();
  });

  it('refuses to save an invalid id', async () => {
    await expect(repo.save(record('../x'))).rejects.toThrow('Invalid schedule id');
  });
});
