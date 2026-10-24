import { isValidBranchName, isValidSlug, planFile, PLANS_DIR } from '../../../../src/service/architecture/architecture-names';

describe('architecture names', () => {
  it('accepts good branch names', () => {
    for (const n of ['main', 'feature/gift-cards', 'agentic/T-20261024-ab12-move-catalog']) {
      expect(isValidBranchName(n)).toBe(true);
    }
  });
  it('refuses bad branch names', () => {
    for (const n of ['--upload-pack=x', '-x', 'a..b', 'a//b', '/a', 'a/', 'x.lock', 'a b', 'a;b', 'a\nb', 'a/.b', 'a.', '', 'a'.repeat(201)]) {
      expect(isValidBranchName(n)).toBe(false);
    }
    expect(isValidBranchName('a'.repeat(200))).toBe(true);
  });
  it('checks slugs', () => {
    expect(isValidSlug('2026-10-20-gift-cards')).toBe(true);
    for (const s of ['../x', 'A', 'a/b', '.x', 'a..b', '']) expect(isValidSlug(s)).toBe(false);
  });
  it('builds the plan path', () => {
    expect(planFile('x')).toBe(`${PLANS_DIR}/x.json`);
  });
});
