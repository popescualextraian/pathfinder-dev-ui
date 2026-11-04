import { BadRequestException } from '@nestjs/common';

// The files of the task's own /task folder that may be read (not the worktree): the end of a scheduled run.
export const TASK_FILE_NAMES = ['result.md', 'state.json'] as const;
export type TaskFileName = (typeof TASK_FILE_NAMES)[number];

export function assertTaskFileName(name: string): asserts name is TaskFileName {
  if (!(TASK_FILE_NAMES as readonly string[]).includes(name)) throw new BadRequestException(`Task file ${JSON.stringify(name)} is not readable`);
}

// A repository folder of a multi project (/work/<name>): one plain path segment.
export const TARGET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function assertTargetName(target: string): void {
  if (!TARGET_NAME.test(target) || target.includes('..')) throw new BadRequestException(`${JSON.stringify(target)} is not a repository folder name`);
}

// The folder the agent works in: the task's worktree, below it the target repository of a multi project.
export function worktreeDir(taskId: string, target?: string): string {
  return `/work/.worktrees/${taskId}${target === undefined ? '' : `/${target}`}`;
}

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
