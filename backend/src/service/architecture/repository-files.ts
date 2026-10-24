// Read access to the files of a configured repository's branches (implemented by the integration layer with git).
export const REPOSITORY_FILES = Symbol('REPOSITORY_FILES');

export interface RepositoryFiles {
  // The remote's default branch and its commit.
  head(repository: string): Promise<{ branch: string; sha: string }>;
  // All branches, sorted by name.
  branches(repository: string): Promise<{ name: string; sha: string }[]>;
  // Files below dir (recursive), [] if none or the branch is unknown; id = blob id.
  list(repository: string, branch: string, dir: string): Promise<{ path: string; id: string }[]>;
  // The file's text; null: no such file (or branch).
  read(repository: string, branch: string, path: string, maxBytes: number): Promise<string | null>;
}

// Clone/fetch failed and there is no clone to serve from. The message never carries a secret, URL or path.
export class RepositoryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryUnavailableError';
  }
}

export class RepositoryFileTooLargeError extends Error {
  constructor(
    readonly path: string,
    readonly maxBytes: number,
  ) {
    super(`${path} is larger than ${maxBytes} bytes`);
    this.name = 'RepositoryFileTooLargeError';
  }
}

// The repository name is not configured.
export class RepositoryUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryUnknownError';
  }
}
