import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { FIXTURE_DIR, FixtureRepo, makeFixtureRepo } from '../../../helpers/architecture-repo';
import { GitRepositoryFiles } from '../../../../src/integration/architecture/git-repository-files';
import { gitRunner } from '../../../../src/integration/architecture/git-runner';
import {
  RepositoryFileTooLargeError,
  RepositoryUnavailableError,
  RepositoryUnknownError,
} from '../../../../src/service/architecture/repository-files';
import { MODEL_FILE, PLANS_DIR } from '../../../../src/service/architecture/architecture-names';

const TOKEN = 'ghp_made-up-token';
const GIFT = `${PLANS_DIR}/2026-10-20-gift-cards.json`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

jest.setTimeout(30_000);

describe('GitRepositoryFiles', () => {
  let fixture: FixtureRepo;
  let dataRoot: string;
  let dataDir: string;
  let clock: number;
  let warn: jest.SpyInstance;

  const make = (url = fixture.path, dir = dataDir): GitRepositoryFiles =>
    new GitRepositoryFiles({
      dataDir: dir,
      fetchSeconds: 60,
      repositories: [{ name: 'acme-shop', url }],
      env: { PATH: process.env.PATH, GH_TOKEN: TOKEN },
      now: () => clock,
    });

  beforeAll(() => {
    fixture = makeFixtureRepo();
  });
  afterAll(() => fixture.cleanup());

  beforeEach(() => {
    clock = 1_000_000;
    dataRoot = mkdtempSync(join(tmpdir(), 'arch-data-'));
    dataDir = join(dataRoot, 'architecture');
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('head is the default branch and its sha', async () => {
    const files = make();
    const head = await files.head('acme-shop');
    expect(head).toEqual({ branch: 'main', sha: git(fixture.path, 'rev-parse', 'refs/heads/main').trim() });
  });

  it('branches lists all heads, newest commit first', async () => {
    const files = make();
    await new Promise((r) => setTimeout(r, 1100)); // commit dates have one-second resolution
    fixture.commit('feature/gift-cards', { 'docs/architecture/touch.txt': 'x' });
    const branches = await files.branches('acme-shop');
    expect(branches.map((b) => b.name)[0]).toBe('feature/gift-cards');
    expect(branches.map((b) => b.name).sort()).toEqual(['agentic/T-20261024-ab12-move-catalog', 'feature/gift-cards', 'main']);
    for (const b of branches) expect(b.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('lists files below a directory with their blob ids', async () => {
    const files = make();
    const list = await files.list('acme-shop', 'feature/gift-cards', PLANS_DIR);
    expect(list).toEqual([{ path: GIFT, id: expect.stringMatching(/^[0-9a-f]{40}$/) }]);
    expect(await files.list('acme-shop', 'main', PLANS_DIR)).toEqual([]);
    expect(await files.list('acme-shop', 'no-such-branch', PLANS_DIR)).toEqual([]);
  });

  it('reads a file, null when missing, refuses a file over maxBytes', async () => {
    const files = make();
    expect(await files.read('acme-shop', 'main', MODEL_FILE, 1_000_000)).toBe(readFileSync(join(FIXTURE_DIR, 'model.json'), 'utf8'));
    expect(await files.read('acme-shop', 'main', GIFT, 1_000_000)).toBeNull();
    expect(await files.read('acme-shop', 'main', PLANS_DIR, 1_000_000)).toBeNull();
    expect(await files.read('acme-shop', 'no-such-branch', MODEL_FILE, 1_000_000)).toBeNull();
    const err = await files.read('acme-shop', 'main', MODEL_FILE, 10).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryFileTooLargeError);
    expect(err).toMatchObject({ path: MODEL_FILE, maxBytes: 10 });
  });

  it('an unknown repository is RepositoryUnknownError', async () => {
    await expect(make().head('other')).rejects.toBeInstanceOf(RepositoryUnknownError);
  });

  describe('with its own remote', () => {
    let own: FixtureRepo;
    beforeEach(() => {
      own = makeFixtureRepo({ name: 'own' });
    });
    afterEach(() => own.cleanup());

    it('fetches at most once per fetchSeconds', async () => {
      const files = make(own.path);
      const first = await files.head('acme-shop');
      const sha = own.commit('main', { 'docs/architecture/extra.txt': 'new' });
      clock += 59_000;
      expect(await files.head('acme-shop')).toEqual(first);
      expect(await files.read('acme-shop', 'main', 'docs/architecture/extra.txt', 100)).toBeNull();
      clock += 1_000;
      expect(await files.head('acme-shop')).toEqual({ branch: 'main', sha });
      expect(await files.read('acme-shop', 'main', 'docs/architecture/extra.txt', 100)).toBe('new');
    });

    it('prunes branches deleted in the remote', async () => {
      const files = make(own.path);
      expect((await files.branches('acme-shop')).map((b) => b.name)).toContain('feature/gift-cards');
      git(own.path, 'update-ref', '-d', 'refs/heads/feature/gift-cards');
      clock += 60_000;
      expect((await files.branches('acme-shop')).map((b) => b.name)).not.toContain('feature/gift-cards');
    });

    it('follows a change of the default branch', async () => {
      const files = make(own.path);
      await files.head('acme-shop');
      git(own.path, 'symbolic-ref', 'HEAD', 'refs/heads/feature/gift-cards');
      clock += 60_000;
      expect((await files.head('acme-shop')).branch).toBe('feature/gift-cards');
    });

    it('serves stale data when the remote is gone and logs a redacted warning', async () => {
      const files = make(own.path);
      const head = await files.head('acme-shop');
      rmSync(own.path, { recursive: true, force: true });
      clock += 60_000;
      expect(await files.head('acme-shop')).toEqual(head);
      expect(await files.read('acme-shop', 'main', MODEL_FILE, 1_000_000)).toContain('"version": 1');
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
    });
  });

  it('without a clone and no remote is RepositoryUnavailableError without secrets', async () => {
    const gone = join(dataRoot, 'gone.git');
    const files = make(gone);
    const err = await files.head('acme-shop').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryUnavailableError);
    const message = (err as Error).message;
    expect(message).toBe('could not read repository acme-shop');
    expect(message).not.toContain(gone);
    expect(message).not.toContain(TOKEN);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
    expect(existsSync(join(dataDir, 'acme-shop.git'))).toBe(false);
  });

  it.each(['--upload-pack=touch /tmp/x', '-x', 'a..b', 'refs/../x', ''])('refuses branch %p before any git process', async (branch) => {
    const files = make();
    const run = jest.spyOn(gitRunner, 'run');
    await expect(files.list('acme-shop', branch, PLANS_DIR)).rejects.toThrow('invalid branch name');
    await expect(files.read('acme-shop', branch, MODEL_FILE, 100)).rejects.toThrow('invalid branch name');
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['../x', 'docs/architecture/../../etc', '-x', 'src', 'docs/architecture'])('refuses path %p before any git process', async (path) => {
    const files = make();
    const run = jest.spyOn(gitRunner, 'run');
    await expect(files.list('acme-shop', 'main', path)).rejects.toThrow('invalid path');
    await expect(files.read('acme-shop', 'main', path, 100)).rejects.toThrow('invalid path');
    expect(run).not.toHaveBeenCalled();
  });

  it('makes the data dir and the clone mode 700 and writes no token into the clone', async () => {
    await make().head('acme-shop');
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    const clone = join(dataDir, 'acme-shop.git');
    expect(statSync(clone).mode & 0o777).toBe(0o700);
    const config = readFileSync(join(clone, 'config'), 'utf8');
    expect(config).not.toContain(TOKEN);
    expect(config).toContain('fetch = +refs/heads/*:refs/heads/*');
    const all = readdirSync(clone, { recursive: true, encoding: 'utf8' }).map((f) => join(clone, f));
    for (const f of all) if (statSync(f).isFile()) expect(readFileSync(f).includes(TOKEN)).toBe(false);
  });

  it('concurrent calls clone once', async () => {
    const run = jest.spyOn(gitRunner, 'run');
    const files = make();
    const heads = await Promise.all([files.head('acme-shop'), files.head('acme-shop'), files.branches('acme-shop')]);
    expect(heads[0]).toEqual(heads[1]);
    expect(run.mock.calls.filter(([args]) => args[0] === 'clone')).toHaveLength(1);
  });

  it('reuses an existing clone from an earlier instance', async () => {
    await make().head('acme-shop');
    const run = jest.spyOn(gitRunner, 'run');
    expect((await make().head('acme-shop')).branch).toBe('main');
    expect(run.mock.calls.filter(([args]) => args[0] === 'clone')).toHaveLength(0);
  });

  it('a file:// remote is a partial clone whose blobs are fetched when read', async () => {
    const files = make(`file://${fixture.path}`);
    await files.head('acme-shop');
    const clone = join(dataDir, 'acme-shop.git');
    const missing = () => git(clone, 'rev-list', '--objects', '--missing=print', '--all').split('\n').filter((l) => l.startsWith('?'));
    const before = missing().length;
    expect(before).toBeGreaterThan(0);
    expect(await files.read('acme-shop', 'main', MODEL_FILE, 1_000_000)).toBe(readFileSync(join(FIXTURE_DIR, 'model.json'), 'utf8'));
    expect(missing().length).toBe(before - 1);
  });
});
