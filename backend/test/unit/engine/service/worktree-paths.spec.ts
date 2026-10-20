import { BadRequestException } from '@nestjs/common';
import { assertWorktreePaths } from '../../../../src/engine/service/worktree-paths';

describe('assertWorktreePaths', () => {
  it('accepts relative paths, nested and with dots in names', () => {
    expect(() => assertWorktreePaths(['plans/1.md', 'a/b/c.txt', '.agentic/x', 'a..b'])).not.toThrow();
  });
  it.each([
    [''], ['/etc/passwd'], ['..'], ['../x'], ['a/../b'], ['a/..'], ['a\\..\\b'], ['a\0b'], ['\\abs'], ['C:\\x'],
  ])('refuses %j with a 400', (bad) => {
    expect(() => assertWorktreePaths(['ok.md', bad])).toThrow(BadRequestException);
  });
  it('refuses non-string entries', () => {
    expect(() => assertWorktreePaths([1 as never])).toThrow(BadRequestException);
  });
});
