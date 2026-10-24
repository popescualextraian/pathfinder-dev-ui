import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArchitectureBadRequestError, ArchitectureNotFoundError } from '../../../../src/service/architecture/architecture-errors';
import { ArchitectureService } from '../../../../src/service/architecture/architecture.service';
import { ArchitectureFileError } from '../../../../src/service/architecture/architecture-validator';
import { FIXTURE_DIR } from '../../../helpers/architecture-repo';
import { RepositoryUnavailableError } from '../../../../src/service/architecture/repository-files';
import { fakeRepositoryFiles } from '../../../helpers/fake-repository-files';

const fx = (n: string): string => readFileSync(join(FIXTURE_DIR, n), 'utf8');
const P = 'docs/architecture/reviews/plans/';
const MODEL = 'docs/architecture/model.json';
const GIFT = fx('2026-10-20-gift-cards.json');
const MOVE = fx('2026-10-22-move-catalog.json');
const BAD = fx('invalid/plan-unknown-component.json');

function setup(branches: Record<string, Record<string, string>>) {
  const files = fakeRepositoryFiles({
    default: {
      default: 'main',
      branches: Object.fromEntries(Object.entries(branches).map(([n, f]) => [n, { sha: `sha-${n}`, files: f }])),
    },
    other: { default: 'main', branches: { main: { sha: 'o1', files: {} } } },
  });
  const repos = {
    list: () => [
      { name: 'default', url: 'https://github.com/acme/default.git', default: true },
      { name: 'other', url: '/srv/other.git', default: false },
    ],
  };
  return { files, service: new ArchitectureService(repos as never, files) };
}

describe('ArchitectureService', () => {
  it('lists repositories', () => {
    expect(setup({ main: {} }).service.status()).toEqual({ repositories: ['default', 'other'] });
  });

  describe('current', () => {
    it('returns model, full review and pageBase', async () => {
      const { service } = setup({
        main: { [MODEL]: fx('model.json'), 'docs/architecture/reviews/full.json': fx('full.json') },
      });
      const c = await service.current();
      expect(c.repository).toBe('default');
      expect(c.branch).toBe('main');
      expect(c.sha).toBe('sha-main');
      expect(c.model.version).toBe(1);
      expect(c.fullReview?.kind).toBe('full');
      expect(c.fullReviewError).toBeNull();
      expect(c.pageBase).toBe('https://github.com/acme/default/blob/main/docs/architecture/');
    });
    it('no full review is null without error', async () => {
      const c = await setup({ main: { [MODEL]: fx('model.json') } }).service.current();
      expect(c.fullReview).toBeNull();
      expect(c.fullReviewError).toBeNull();
    });
    it('invalid full review gives the picture and an error naming the file', async () => {
      const { service } = setup({
        main: { [MODEL]: fx('model.json'), 'docs/architecture/reviews/full.json': '{"version":9}' },
      });
      const c = await service.current();
      expect(c.model).toBeDefined();
      expect(c.fullReview).toBeNull();
      expect(c.fullReviewError).toContain('docs/architecture/reviews/full.json');
    });
    it('no model is NotFound', async () => {
      await expect(setup({ main: {} }).service.current()).rejects.toThrow(
        new ArchitectureNotFoundError('no docs/architecture/model.json on main'),
      );
    });
    it('invalid model is an ArchitectureFileError', async () => {
      const { service } = setup({ main: { [MODEL]: fx('invalid/model-version-2.json') } });
      const e = await service.current().catch((x) => x);
      expect(e).toBeInstanceOf(ArchitectureFileError);
      expect(e.message).toContain(MODEL);
    });
    it('unknown repository is NotFound; named repository works', async () => {
      const { service } = setup({ main: {} });
      await expect(service.current('nope')).rejects.toBeInstanceOf(ArchitectureNotFoundError);
      await expect(service.current('other')).rejects.toBeInstanceOf(ArchitectureNotFoundError);
    });
  });

  describe('reviews', () => {
    const main = { [MODEL]: fx('model.json') };
    it('lists reviews newest first with touched and findings counts', async () => {
      const { service } = setup({
        main,
        'feature/gift-cards': { ...main, [`${P}2026-10-20-gift-cards.json`]: GIFT },
        'agentic/x-move-catalog': { ...main, [`${P}2026-10-22-move-catalog.json`]: MOVE },
      });
      const r = await service.reviews();
      expect(r.refused).toEqual([]);
      expect(r.reviews.map((x) => x.slug)).toEqual(['2026-10-22-move-catalog', '2026-10-20-gift-cards']);
      const gift = r.reviews[1];
      expect(gift.branch).toBe('feature/gift-cards');
      expect(gift.sha).toBe('sha-feature/gift-cards');
      expect(gift.touched).toHaveLength(4);
      expect(gift.openFindings).toBe(1);
      expect(r.reviews[0].touched).toHaveLength(3);
      expect(r.reviews[0].openFindings).toBe(0);
    });
    it('inherited reviews are listed once, for the branch that adds them', async () => {
      const path = `${P}2026-10-20-gift-cards.json`;
      const { service } = setup({
        main: { ...main, [path]: GIFT },
        'feature/a': { ...main, [path]: GIFT },
      });
      const r = await service.reviews();
      expect(r.reviews.map((x) => x.branch)).toEqual(['main']);
    });
    it('an invalid review is refused, others still list; branch without model refused', async () => {
      const { service } = setup({
        main,
        'feature/bad': { ...main, [`${P}broken.json`]: BAD },
        'feature/good': { ...main, [`${P}2026-10-22-move-catalog.json`]: MOVE },
        'feature/nomodel': { [`${P}x.json`]: MOVE },
      });
      const r = await service.reviews();
      expect(r.reviews.map((x) => x.branch)).toEqual(['feature/good']);
      expect(r.refused).toHaveLength(2);
      const bad = r.refused.find((x) => x.branch === 'feature/bad')!;
      expect(bad.slug).toBe('broken');
      expect(bad.file).toBe(`${P}broken.json`);
      expect(bad.error).toContain('invoice-service');
      expect(r.refused.find((x) => x.branch === 'feature/nomodel')!.error).toBe(
        'no docs/architecture/model.json on feature/nomodel',
      );
    });
    it('skips remote branches whose name is not valid instead of failing', async () => {
      const { service } = setup({
        main,
        'dependabot/@types/node-20': { ...main, [`${P}x.json`]: MOVE },
        'feature/good': { ...main, [`${P}2026-10-22-move-catalog.json`]: MOVE },
      });
      const r = await service.reviews();
      expect(r.reviews.map((x) => x.branch)).toEqual(['feature/good']);
      expect(r.refused).toEqual([]);
    });
    it('keeps the default branch first then the given order, caps at 100 and says so', async () => {
      const branches: Record<string, Record<string, string>> = { 'b0': { ...main } };
      for (let i = 1; i <= 120; i++) branches[`b${i}`] = { ...main, [`${P}p${i}.json`]: MOVE };
      branches.main = { ...main, [`${P}2026-10-20-gift-cards.json`]: GIFT };
      const { service, files } = setup(branches);
      const r = await service.reviews();
      expect(r.truncated).toBe(true);
      const seen = new Set(r.reviews.map((x) => x.branch));
      expect(seen.has('main')).toBe(true);
      expect(seen.has('b98')).toBe(true);
      expect(seen.has('b99')).toBe(false);
      expect(files.calls).toBeGreaterThan(0);
      expect((await setup({ main }).service.reviews()).truncated).toBe(false);
    });
    it('a failing read or list of one branch refuses it, the rest still lists', async () => {
      const { service, files } = setup({
        main,
        'feature/down': { ...main, [`${P}a.json`]: MOVE },
        'feature/listdown': { ...main, [`${P}b.json`]: MOVE },
        'feature/good': { ...main, [`${P}2026-10-22-move-catalog.json`]: MOVE },
      });
      files.failOn = (op, branch, path) =>
        (op === 'read' && branch === 'feature/down' && path.endsWith('a.json')) ||
        (op === 'list' && branch === 'feature/listdown')
          ? new RepositoryUnavailableError('could not read repository default')
          : undefined;
      const r = await service.reviews();
      expect(r.reviews.map((x) => x.branch)).toEqual(['feature/good']);
      expect(r.refused.map((x) => [x.branch, x.error])).toEqual([
        ['feature/down', 'could not read repository default'],
        ['feature/listdown', 'could not read repository default'],
      ]);
    });
    it('ignores plan files beyond 50 per branch', async () => {
      const plans: Record<string, string> = { ...main };
      for (let i = 0; i < 60; i++) plans[`${P}p${String(i).padStart(2, '0')}.json`] = MOVE;
      const r = await setup({ main: plans }).service.reviews();
      expect(r.reviews).toHaveLength(50);
    });
    it('ignores nested files', async () => {
      const { service } = setup({ main: { ...main, [`${P}sub/a.json`]: GIFT, [`${P}a.txt`]: 'x' } });
      const r = await service.reviews();
      expect(r.reviews).toEqual([]);
      expect(r.refused).toEqual([]);
    });
  });

  describe('review', () => {
    it('returns the detail with the branch model', async () => {
      const model = JSON.parse(fx('model.json'));
      model.style.name = 'Branch style';
      const { service } = setup({
        main: { [MODEL]: fx('model.json') },
        'feature/gift-cards': { [MODEL]: JSON.stringify(model), [`${P}g.json`]: GIFT },
      });
      const d = await service.review(undefined, 'feature/gift-cards', 'g');
      expect(d.model.style.name).toBe('Branch style');
      expect(d.review.title).toBe('Gift cards at checkout');
      expect(d.sha).toBe('sha-feature/gift-cards');
      expect(d.pageBase).toBe('https://github.com/acme/default/blob/feature/gift-cards/docs/architecture/');
    });
    it('bad names are 400 without touching files', async () => {
      const { service, files } = setup({ main: {} });
      await expect(service.review(undefined, '--x', 'a')).rejects.toBeInstanceOf(ArchitectureBadRequestError);
      await expect(service.review(undefined, 'main', '../x')).rejects.toBeInstanceOf(ArchitectureBadRequestError);
      expect(files.calls).toBe(0);
    });
    it('unknown slug is NotFound; invalid review is a file error', async () => {
      const { service } = setup({ main: { [MODEL]: fx('model.json'), [`${P}b.json`]: BAD } });
      await expect(service.review(undefined, 'main', 'zzz')).rejects.toBeInstanceOf(ArchitectureNotFoundError);
      await expect(service.review(undefined, 'main', 'b')).rejects.toBeInstanceOf(ArchitectureFileError);
    });
  });
});
