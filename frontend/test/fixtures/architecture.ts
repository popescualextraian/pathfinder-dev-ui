import { readFileSync } from 'fs';
import { join } from 'path';
import type { FullReview, Model, PlanReview, ReviewSummary } from '../../src/api/models';

const dir = join(__dirname, '..', '..', '..', 'backend', 'test', 'fixtures', 'architecture');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
}

/** Fresh copies each call (tests may change them). */
export const fixtureModel = (): Model => load<Model>('model.json');
export const onePartModel = (): Model => load<Model>('one-part-model.json');
export const fullReview = (): FullReview => load<FullReview>('full.json');
export const giftCards = (): PlanReview => load<PlanReview>('2026-10-20-gift-cards.json');
export const moveCatalog = (): PlanReview => load<PlanReview>('2026-10-22-move-catalog.json');

export function summaryOf(review: PlanReview, branch: string, slug: string, over: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    branch,
    slug,
    sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    title: review.title,
    plan: review.plan,
    reviewedAt: review.reviewedAt,
    size: review.size,
    summary: review.summary,
    touched: review.changes.map((c) => ({ component: c.component, change: c.change })),
    openFindings: review.findings.filter((f) => f.status === 'open').length,
    findings: review.findings.length,
    ...over,
  };
}
