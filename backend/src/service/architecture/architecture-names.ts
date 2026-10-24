export const MODEL_FILE = 'docs/architecture/model.json';
export const FULL_REVIEW_FILE = 'docs/architecture/reviews/full.json';
export const PLANS_DIR = 'docs/architecture/reviews/plans';

export function isValidBranchName(name: string): boolean {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(name)) return false;
  if (name.includes('..') || name.includes('//') || name.includes('/.')) return false;
  if (name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
  return true;
}

export function isValidSlug(slug: string): boolean {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(slug) && !slug.includes('..');
}

export function planFile(slug: string): string {
  return `${PLANS_DIR}/${slug}.json`;
}
