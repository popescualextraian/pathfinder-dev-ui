import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { FULL_REVIEW_FILE, MODEL_FILE, PLANS_DIR, isValidBranchName } from '../../service/architecture/architecture-names';
import {
  RepositoryFileTooLargeError,
  RepositoryFiles,
  RepositoryUnavailableError,
  RepositoryUnknownError,
} from '../../service/architecture/repository-files';
import { GitError, gitEnv, gitRunner, redact, withoutUserinfo } from './git-runner';

export interface GitRepositoryFilesConfig {
  dataDir: string;
  fetchSeconds: number;
  repositories: { name: string; url: string }[];
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

interface Repository {
  name: string;
  url: string; // without userinfo
  dir: string; // the bare clone
  env: NodeJS.ProcessEnv;
}

interface SyncState {
  chain: Promise<void>;
  cloned: boolean;
  lastSync: number; // time of the last clone or fetch attempt
  failedAt?: number; // time of the last failed clone
}

const ARCHITECTURE_DIR = 'docs/architecture/';
const FIXED_PATHS = [MODEL_FILE, FULL_REVIEW_FILE, PLANS_DIR];
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

function isValidPath(path: string): boolean {
  if (typeof path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(path)) return false;
  if (path.includes('..') || path.includes('//') || path.endsWith('/')) return false;
  return FIXED_PATHS.includes(path) || path.startsWith(ARCHITECTURE_DIR);
}

function checkBranch(branch: string): void {
  if (!isValidBranchName(branch)) throw new Error('invalid branch name');
}

function checkPath(path: string): void {
  if (!isValidPath(path)) throw new Error('invalid path');
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

// Parses `git ls-tree -z` output: `<mode> <type> <oid>\t<path>\0`, blobs only.
function parseTree(out: Buffer): { path: string; id: string }[] {
  const entries: { path: string; id: string }[] = [];
  for (const record of out.toString('utf8').split('\0')) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [, type, id] = record.slice(0, tab).split(' ');
    if (type === 'blob' && /^[0-9a-f]{40,64}$/.test(id)) entries.push({ path: record.slice(tab + 1), id });
  }
  return entries;
}

// RepositoryFiles on a bare partial clone (`--filter=blob:none`) per configured repository in `dataDir`: trees come with
// each fetch, blobs are fetched by git when first read. A fetch runs at most once per `fetchSeconds`, one at a time per
// repository; when it fails the clone is served as it is. Git runs with argument arrays only; branch names and paths
// are validated before any git process starts; the token is only ever referenced by the credential helper.
export class GitRepositoryFiles implements RepositoryFiles {
  private readonly logger = new Logger(GitRepositoryFiles.name);
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly states = new Map<string, SyncState>();

  constructor(private readonly config: GitRepositoryFilesConfig) {
    this.env = config.env ?? process.env;
    this.now = config.now ?? Date.now;
  }

  async head(repository: string): Promise<{ branch: string; sha: string }> {
    const repo = this.repository(repository);
    await this.sync(repo);
    const ref = (await this.git(repo, ['symbolic-ref', '-q', 'HEAD']).catch(() => Buffer.from(''))).toString('utf8').trim();
    const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : '';
    const sha = branch ? (await this.branchList(repo)).find((b) => b.name === branch)?.sha : undefined;
    if (!sha) throw new RepositoryUnavailableError(`repository ${repo.name} has no default branch`);
    return { branch, sha };
  }

  async branches(repository: string): Promise<{ name: string; sha: string }[]> {
    const repo = this.repository(repository);
    await this.sync(repo);
    return this.branchList(repo);
  }

  async list(repository: string, branch: string, dir: string): Promise<{ path: string; id: string }[]> {
    const repo = this.repository(repository);
    checkBranch(branch);
    checkPath(dir);
    await this.sync(repo);
    const sha = await this.branchSha(repo, branch);
    if (!sha) return [];
    const entries = parseTree(await this.git(repo, ['ls-tree', '-r', '-z', sha, '--', dir]));
    return entries.filter((e) => e.path.startsWith(`${dir}/`)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async read(repository: string, branch: string, path: string, maxBytes: number): Promise<string | null> {
    const repo = this.repository(repository);
    checkBranch(branch);
    checkPath(path);
    await this.sync(repo);
    const sha = await this.branchSha(repo, branch);
    if (!sha) return null;
    const entry = parseTree(await this.git(repo, ['ls-tree', '-z', sha, '--', path])).find((e) => e.path === path);
    if (!entry) return null;
    const size = Number((await this.git(repo, ['cat-file', '-s', entry.id])).toString('utf8').trim());
    if (!Number.isFinite(size) || size > maxBytes) throw new RepositoryFileTooLargeError(path, maxBytes);
    return (await this.git(repo, ['cat-file', 'blob', entry.id])).toString('utf8');
  }

  private repository(name: string): Repository {
    const entry = this.config.repositories.find((r) => r.name === name);
    if (!entry) throw new RepositoryUnknownError(`unknown repository ${name}`);
    if (!SAFE_NAME.test(name) || name.includes('..')) throw new RepositoryUnavailableError(`could not read repository ${name}`);
    const url = withoutUserinfo(entry.url);
    return { name, url, dir: join(this.config.dataDir, `${name}.git`), env: gitEnv(url, this.env) };
  }

  private state(name: string): SyncState {
    let state = this.states.get(name);
    if (!state) {
      state = { chain: Promise.resolve(), cloned: false, lastSync: -Infinity };
      this.states.set(name, state);
    }
    return state;
  }

  // One clone/fetch at a time per repository: calls queue on the repository's chain.
  private sync(repo: Repository): Promise<void> {
    const state = this.state(repo.name);
    const run = state.chain.then(() => this.syncNow(repo, state));
    state.chain = run.catch(() => undefined);
    return run;
  }

  private async syncNow(repo: Repository, state: SyncState): Promise<void> {
    const now = this.now();
    const interval = this.config.fetchSeconds * 1000;
    if (!state.cloned && (await exists(join(repo.dir, 'HEAD')))) {
      // A clone left by an earlier run: point it at the configured URL and fetch now.
      state.cloned = true;
      state.lastSync = -Infinity;
      await this.git(repo, ['remote', 'set-url', 'origin', repo.url]).catch((e: unknown) => this.warn(repo, e));
    }
    if (!state.cloned) {
      if (state.failedAt !== undefined && now - state.failedAt < interval) throw this.unavailable(repo);
      try {
        await this.clone(repo);
      } catch (e) {
        state.failedAt = now;
        this.warn(repo, e);
        throw this.unavailable(repo);
      }
      state.cloned = true;
      state.failedAt = undefined;
      state.lastSync = now;
      return;
    }
    if (now - state.lastSync < interval) return;
    state.lastSync = now;
    try {
      await this.git(repo, ['fetch', '--prune', '--update-head-ok', 'origin']);
    } catch (e) {
      this.warn(repo, e, ' (serving the last fetched state)');
      return;
    }
    await this.updateHead(repo);
  }

  private async clone(repo: Repository): Promise<void> {
    const { dataDir } = this.config;
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700);
    const partial = join(dataDir, `.${repo.name}.git.partial`);
    await rm(partial, { recursive: true, force: true });
    try {
      await gitRunner.run(['clone', '--bare', '--filter=blob:none', '--no-tags', '--', repo.url, partial], {
        cwd: dataDir,
        env: repo.env,
      });
      await gitRunner.run(['config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*'], { cwd: partial, env: repo.env });
      await chmod(partial, 0o700);
      await rename(partial, repo.dir);
    } catch (e) {
      await rm(partial, { recursive: true, force: true });
      throw e;
    }
  }

  // Follows a change of the remote's default branch; failure leaves HEAD as it is.
  private async updateHead(repo: Repository): Promise<void> {
    try {
      const out = (await this.git(repo, ['ls-remote', '--symref', 'origin', 'HEAD'])).toString('utf8');
      const match = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(out);
      if (match && isValidBranchName(match[1])) await this.git(repo, ['symbolic-ref', 'HEAD', `refs/heads/${match[1]}`]);
    } catch {
      // keep the current HEAD
    }
  }

  private async branchList(repo: Repository): Promise<{ name: string; sha: string }[]> {
    const out = (await this.git(repo, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:strip=2) %(objectname)', 'refs/heads/'])).toString('utf8');
    const branches: { name: string; sha: string }[] = [];
    for (const line of out.split('\n')) {
      const space = line.lastIndexOf(' ');
      if (space > 0) branches.push({ name: line.slice(0, space), sha: line.slice(space + 1) });
    }
    return branches;
  }

  private async branchSha(repo: Repository, branch: string): Promise<string | undefined> {
    return (await this.branchList(repo)).find((b) => b.name === branch)?.sha;
  }

  private async git(repo: Repository, args: string[]): Promise<Buffer> {
    try {
      return await gitRunner.run(args, { cwd: repo.dir, env: repo.env });
    } catch (e) {
      if (e instanceof GitError && !['remote', 'fetch', 'ls-remote', 'symbolic-ref'].includes(args[0])) {
        // e.g. a blob that cannot be fetched lazily while the remote is unreachable
        this.warn(repo, e);
        throw this.unavailable(repo);
      }
      throw e;
    }
  }

  private unavailable(repo: Repository): RepositoryUnavailableError {
    return new RepositoryUnavailableError(`could not read repository ${repo.name}`);
  }

  private warn(repo: Repository, error: unknown, suffix = ''): void {
    const text = error instanceof Error ? error.message : String(error);
    this.logger.warn(`repository ${repo.name}: ${redact(text, this.env)}${suffix}`);
  }
}
