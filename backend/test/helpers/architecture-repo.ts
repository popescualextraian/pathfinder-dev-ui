import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const FIXTURE_DIR = resolve(__dirname, '../fixtures/architecture');

export interface FixtureRepo {
  path: string;
  root: string;
  commit(branch: string, files: Record<string, string | null>, message?: string): string;
  cleanup(): void;
}

const IDENTITY = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com'];
const ARCH = 'docs/architecture';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

export function makeFixtureRepo(
  options: { root?: string; name?: string; model?: 'fixture' | 'one-part'; extraBranches?: boolean } = {},
): FixtureRepo {
  const kind = options.model ?? 'fixture';
  const extra = options.extraBranches ?? kind === 'fixture';
  const name = options.name ?? 'acme-shop';
  const madeRoot = options.root === undefined || !existsSync(options.root);
  const root = options.root ? resolve(options.root) : mkdtempSync(join(tmpdir(), 'arch-fixture-'));
  mkdirSync(root, { recursive: true });
  const path = join(root, `${name}.git`);
  const scratch = mkdtempSync(join(tmpdir(), 'arch-fixture-work-'));

  git(root, 'init', '--bare', '--initial-branch=main', path);
  git(path, 'config', 'uploadpack.allowFilter', 'true');
  git(path, 'config', 'uploadpack.allowAnySHA1InWant', 'true');

  const commit = (branch: string, files: Record<string, string | null>, message = `Update ${branch}`): string => {
    const work = mkdtempSync(join(scratch, 'wt-'));
    try {
      git(work, 'init', '--initial-branch=main');
      git(work, 'remote', 'add', 'origin', path);
      const exists = git(path, 'for-each-ref', `refs/heads/${branch}`).trim() !== '';
      const hasMain = git(path, 'for-each-ref', 'refs/heads/main').trim() !== '';
      if (exists) {
        git(work, 'fetch', 'origin', branch);
        git(work, 'checkout', '-B', branch, 'FETCH_HEAD');
      } else if (hasMain) {
        git(work, 'fetch', 'origin', 'main');
        git(work, 'checkout', '-B', branch, 'FETCH_HEAD');
      } else {
        git(work, 'checkout', '-B', branch);
      }
      for (const [file, content] of Object.entries(files)) {
        const full = join(work, file);
        if (content === null) rmSync(full, { force: true });
        else {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content);
        }
      }
      git(work, 'add', '-A');
      git(work, 'commit', '--allow-empty', '-m', message);
      git(work, 'push', 'origin', `${branch}:refs/heads/${branch}`);
      return git(work, 'rev-parse', 'HEAD').trim();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  };

  const main: Record<string, string> = {
    [`${ARCH}/model.json`]: fixture(kind === 'fixture' ? 'model.json' : 'one-part-model.json'),
  };
  if (kind === 'fixture') main[`${ARCH}/reviews/full.json`] = fixture('full.json');
  commit('main', main, 'Add architecture model');
  if (extra) {
    commit(
      'feature/gift-cards',
      { [`${ARCH}/reviews/plans/2026-10-20-gift-cards.json`]: fixture('2026-10-20-gift-cards.json') },
      'Add gift-cards plan review',
    );
    commit(
      'agentic/T-20261024-ab12-move-catalog',
      { [`${ARCH}/reviews/plans/2026-10-22-move-catalog.json`]: fixture('2026-10-22-move-catalog.json') },
      'Add move-catalog plan review',
    );
  }

  return {
    path,
    root,
    commit,
    cleanup() {
      rmSync(scratch, { recursive: true, force: true });
      if (madeRoot) rmSync(root, { recursive: true, force: true });
      else rmSync(path, { recursive: true, force: true });
    },
  };
}
