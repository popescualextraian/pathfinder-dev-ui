import { BadRequestException } from '@nestjs/common';

// Paths into a task's worktree: relative, non-empty, no NUL, no `..` segment (either separator),
// not absolute (POSIX or Windows drive). Throws a 400.
export function assertWorktreePaths(paths: readonly string[]): void {
  for (const path of paths) {
    if (typeof path !== 'string' || path === '') throw new BadRequestException('A path must be a non-empty string');
    if (path.includes('\0')) throw new BadRequestException('A path must not contain NUL');
    if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) {
      throw new BadRequestException(`Path ${JSON.stringify(path)} must be relative to the worktree`);
    }
    if (path.split(/[\\/]/).includes('..')) throw new BadRequestException(`Path ${JSON.stringify(path)} must not contain ".."`);
  }
}
