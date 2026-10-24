import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { FixtureRepo, makeFixtureRepo } from '../helpers/architecture-repo';
import { FAKE_GH_TOKEN } from '../helpers/test-env';
import { createApp } from './create-app';

jest.setTimeout(60_000);

const ARCH = 'docs/architecture';

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
}

describe('architecture API (e2e)', () => {
  const repos: FixtureRepo[] = [];
  let app: INestApplication;
  let dataDir: string;
  const api = () => request(app.getHttpServer());
  const fixture = (name: string, options: Parameters<typeof makeFixtureRepo>[0] = {}) => {
    const repo = makeFixtureRepo({ name, ...options });
    repos.push(repo);
    return { name, url: repo.path, repo };
  };
  const start = async (repositories: { name: string; url: string }[], fetchSeconds?: number) => {
    ({ app, dataDir } = await createApp({ architecture: { repositories, fetchSeconds } }));
  };
  afterEach(async () => {
    await app?.close();
    for (const r of repos.splice(0)) r.cleanup();
  });

  it('is off by default', async () => {
    ({ app } = await createApp());
    await api().get('/api/architecture/status').expect(404);
  });

  describe('on', () => {
    it('lists the repositories', async () => {
      const shop = fixture('acme-shop');
      const plain = fixture('plain', { model: 'one-part' });
      await start([shop, plain]);
      const res = await api().get('/api/architecture/status').expect(200);
      expect(res.body).toEqual({ repositories: ['acme-shop', 'plain'] });
    });

    it('serves the current architecture and its full review', async () => {
      const shop = fixture('acme-shop');
      const plain = fixture('plain', { model: 'one-part' });
      await start([shop, plain]);
      const res = await api().get('/api/architecture?repository=acme-shop').expect(200);
      expect(res.body.model.parts).toHaveLength(2);
      expect(res.body.fullReview.findings).toHaveLength(3);
      expect(res.body.branch).toBe('main');
      expect(res.body.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(res.body.pageBase).toBeNull();
      const other = await api().get('/api/architecture?repository=plain').expect(200);
      expect(other.body.fullReview).toBeNull();
      // no repository: the default (first) one
      expect((await api().get('/api/architecture').expect(200)).body.repository).toBe('acme-shop');
    });

    it('404 for an unknown repository, 400 for a malformed name, 404 without docs', async () => {
      const bare = fixture('docless', { model: 'one-part' });
      bare.repo.commit('main', { [`${ARCH}/model.json`]: null });
      await start([bare]);
      await api().get('/api/architecture?repository=docless').expect(404);
      await api().get('/api/architecture?repository=nope').expect(404);
      await api().get('/api/architecture?repository=..%2Fx').expect(400);
      await api().get('/api/architecture/reviews?repository=nope').expect(404);
    });

    it('serves a broken full review as fullReviewError', async () => {
      const shop = fixture('acme-shop');
      shop.repo.commit('main', { [`${ARCH}/reviews/full.json`]: '{"version":1,"kind":"full"' });
      await start([shop]);
      const res = await api().get('/api/architecture?repository=acme-shop').expect(200);
      expect(res.body.fullReview).toBeNull();
      expect(res.body.fullReviewError).toContain('full.json');
    });

    it('lists the reviews and returns one by encoded branch', async () => {
      const shop = fixture('acme-shop');
      await start([shop]);
      const list = await api().get('/api/architecture/reviews?repository=acme-shop').expect(200);
      expect(list.body.reviews).toHaveLength(2);
      const one = await api().get('/api/architecture/reviews/feature%2Fgift-cards/2026-10-20-gift-cards?repository=acme-shop').expect(200);
      expect(one.body.review.title).toBe('Gift cards at checkout');
      expect(one.body.pageBase).toBeNull();
      await api().get('/api/architecture/reviews/agentic%2FT-20261024-ab12-move-catalog/2026-10-22-move-catalog?repository=acme-shop').expect(200);
      await api().get('/api/architecture/reviews/--upload-pack%3Dx/2026-10-20-gift-cards?repository=acme-shop').expect(400);
      await api().get('/api/architecture/reviews/feature%2Fgift-cards/nope?repository=acme-shop').expect(404);
    });

    it('lists an invalid plan as refused and answers 422 naming the file', async () => {
      const shop = fixture('acme-shop');
      shop.repo.commit('feature/broken', { [`${ARCH}/reviews/plans/2026-10-23-broken.json`]: '{"version":1}' });
      await start([shop]);
      const list = await api().get('/api/architecture/reviews?repository=acme-shop').expect(200);
      expect(list.body.reviews).toHaveLength(2);
      expect(list.body.refused).toEqual([
        expect.objectContaining({ branch: 'feature/broken', slug: '2026-10-23-broken', file: `${ARCH}/reviews/plans/2026-10-23-broken.json` }),
      ]);
      const res = await api().get('/api/architecture/reviews/feature%2Fbroken/2026-10-23-broken?repository=acme-shop').expect(422);
      expect(res.body.file).toBe(`${ARCH}/reviews/plans/2026-10-23-broken.json`);
    });

    it('answers 502 when the remote is gone and there is no clone', async () => {
      const shop = fixture('acme-shop');
      await start([shop]);
      rmSync(shop.repo.path, { recursive: true, force: true });
      await api().get('/api/architecture?repository=acme-shop').expect(502);
    });

    it('never shows the token, keeps the clone private', async () => {
      const shop = fixture('acme-shop');
      await start([shop]);
      const bodies = [
        (await api().get('/api/architecture/status')).text,
        (await api().get('/api/architecture?repository=acme-shop')).text,
        (await api().get('/api/architecture/reviews?repository=acme-shop')).text,
        (await api().get('/api/architecture/reviews/feature%2Fgift-cards/2026-10-20-gift-cards?repository=acme-shop')).text,
        (await api().get('/api/architecture?repository=nope')).text,
      ];
      for (const body of bodies) expect(body).not.toContain(FAKE_GH_TOKEN);
      const architectureDir = join(dataDir, 'architecture');
      for (const file of filesUnder(architectureDir)) {
        expect(readFileSync(file).includes(FAKE_GH_TOKEN)).toBe(false);
      }
      expect(statSync(join(architectureDir, 'acme-shop.git')).mode & 0o777).toBe(0o700);
      execFileSync('git', ['--git-dir', join(architectureDir, 'acme-shop.git'), 'rev-parse', 'HEAD']);
    });
  });
});
