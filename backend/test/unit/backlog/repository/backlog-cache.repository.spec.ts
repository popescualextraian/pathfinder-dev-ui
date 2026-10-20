import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacklogCacheRepository } from '../../../../src/backlog/repository/backlog-cache.repository';
import { Item } from '../../../../src/backlog/service/backlog-connector';

const item = (id: string): Item => ({ id, title: `Item ${id}` }) as unknown as Item;

describe('BacklogCacheRepository', () => {
  let dir: string;
  let repo: BacklogCacheRepository;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'backlog-cache-'));
    repo = new BacklogCacheRepository({ dataDir: dir });
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('round-trips items', async () => {
    await repo.save([item('1'), item('2')]);
    expect(await repo.load()).toEqual([item('1'), item('2')]);
  });

  it('writes the file with mode 600', async () => {
    await repo.save([item('1')]);
    expect((await stat(join(dir, 'backlog.json'))).mode & 0o777).toBe(0o600);
  });

  it('loads [] for a missing or corrupt file', async () => {
    expect(await repo.load()).toEqual([]);
    await writeFile(join(dir, 'backlog.json'), '{not json');
    expect(await repo.load()).toEqual([]);
    await writeFile(join(dir, 'backlog.json'), '{"a":1}');
    expect(await repo.load()).toEqual([]);
  });

  it('never stores a token from the environment', async () => {
    process.env.GITLAB_TOKEN = 'glpat-made-up-secret';
    try {
      await repo.save([item('1')]);
      expect(await readFile(join(dir, 'backlog.json'), 'utf8')).not.toContain('glpat-made-up-secret');
    } finally {
      delete process.env.GITLAB_TOKEN;
    }
  });

  it('serialises concurrent saves: the file ends with the last snapshot', async () => {
    const saves = Array.from({ length: 20 }, (_, i) => repo.save([item(String(i))]));
    await Promise.all(saves);
    expect(await repo.load()).toEqual([item('19')]);
  });

  it('keeps saving after a failed write', async () => {
    await writeFile(join(dir, 'blocker'), 'x');
    const bad = new BacklogCacheRepository({ dataDir: join(dir, 'blocker', 'x') });
    await expect(bad.save([item('2')])).rejects.toBeDefined();
    await writeFile(join(dir, 'blocker'), 'x');
    await expect(repo.save([item('3')])).resolves.toBeUndefined();
  });
});
