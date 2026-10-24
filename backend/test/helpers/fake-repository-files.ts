import { createHash } from 'node:crypto';
import type { RepositoryFiles } from '../../src/service/architecture/repository-files';

export interface FakeRepo {
  default: string;
  branches: Record<string, { sha: string; files: Record<string, string> }>;
}

// In-memory RepositoryFiles; `calls` counts every call. Branches come in the order given (newest commit first, like
// the real implementation). `failOn` may return an error to throw for a list/read of a branch (and path).
export function fakeRepositoryFiles(
  repos: Record<string, FakeRepo>,
): RepositoryFiles & { calls: number; failOn?: (op: 'list' | 'read', branch: string, path: string) => Error | undefined } {
  const self: RepositoryFiles & {
    calls: number;
    failOn?: (op: 'list' | 'read', branch: string, path: string) => Error | undefined;
  } = {
    calls: 0,
    async head(repository: string) {
      self.calls++;
      const r = repos[repository];
      return { branch: r.default, sha: r.branches[r.default].sha };
    },
    async branches(repository: string) {
      self.calls++;
      return Object.entries(repos[repository].branches).map(([name, b]) => ({ name, sha: b.sha }));
    },
    async list(repository: string, branch: string, dir: string) {
      self.calls++;
      const err = self.failOn?.('list', branch, dir);
      if (err) throw err;
      const files = repos[repository].branches[branch]?.files ?? {};
      return Object.entries(files)
        .filter(([p]) => p.startsWith(`${dir}/`))
        .map(([path, text]) => ({ path, id: createHash('sha1').update(text).digest('hex') }));
    },
    async read(repository: string, branch: string, path: string) {
      self.calls++;
      const err = self.failOn?.('read', branch, path);
      if (err) throw err;
      return repos[repository].branches[branch]?.files[path] ?? null;
    },
  };
  return self;
}
