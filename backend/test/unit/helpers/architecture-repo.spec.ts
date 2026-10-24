import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_DIR, makeFixtureRepo, FixtureRepo } from '../../helpers/architecture-repo';

const git = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['--git-dir', repo, ...args], { encoding: 'utf8' });

jest.setTimeout(30_000);

describe('makeFixtureRepo', () => {
  const repos: FixtureRepo[] = [];
  const make = (o?: Parameters<typeof makeFixtureRepo>[0]): FixtureRepo => {
    const r = makeFixtureRepo(o);
    repos.push(r);
    return r;
  };
  afterEach(() => repos.splice(0).forEach((r) => r.cleanup()));

  it('builds the fixture branches', () => {
    const r = make();
    const heads = git(r.path, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').trim().split('\n');
    expect(heads.sort()).toEqual(['agentic/T-20261024-ab12-move-catalog', 'feature/gift-cards', 'main']);
    expect(git(r.path, 'show', 'main:docs/architecture/model.json')).toBe(
      readFileSync(join(FIXTURE_DIR, 'model.json'), 'utf8'),
    );
    expect(git(r.path, 'show', 'main:docs/architecture/reviews/full.json')).toBe(
      readFileSync(join(FIXTURE_DIR, 'full.json'), 'utf8'),
    );
    const plan = 'docs/architecture/reviews/plans/2026-10-20-gift-cards.json';
    expect(git(r.path, 'show', `feature/gift-cards:${plan}`)).toContain('{');
    expect(() => git(r.path, 'cat-file', '-e', `main:${plan}`)).toThrow();
    expect(git(r.path, 'config', 'uploadpack.allowFilter').trim()).toBe('true');
  });

  it('commits and deletes files', () => {
    const r = make();
    const sha = r.commit('main', { 'x.txt': 'a' });
    expect(git(r.path, 'rev-parse', 'main').trim()).toBe(sha);
    expect(git(r.path, 'show', 'main:x.txt')).toBe('a');
    r.commit('main', { 'x.txt': null });
    expect(() => git(r.path, 'cat-file', '-e', 'main:x.txt')).toThrow();
    r.commit('new/branch', { 'y.txt': 'b' });
    expect(git(r.path, 'show', 'new/branch:y.txt')).toBe('b');
  });

  it('builds a one-part repo with only main', () => {
    const r = make({ model: 'one-part', extraBranches: false });
    expect(git(r.path, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').trim()).toBe('main');
    expect(git(r.path, 'show', 'main:docs/architecture/model.json')).toBe(
      readFileSync(join(FIXTURE_DIR, 'one-part-model.json'), 'utf8'),
    );
  });

  it('cleanup removes the root', () => {
    const r = makeFixtureRepo();
    expect(existsSync(r.root)).toBe(true);
    r.cleanup();
    expect(existsSync(r.root)).toBe(false);
  });
});
