/** A `requires` path must stay inside the task's worktree: relative, no `..` segment, no NUL. */
export function isSafeRelativePath(path: string): boolean {
  if (path.trim() === '' || path.includes('\0')) return false;
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[\\/]/).includes('..');
}
