import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from './create-app';

// Needs the built frontend in dist/frontend (npm run build).
describe('serving the frontend (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('serves index.html at /', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('<div id="root">');
  });

  it('falls back to index.html for client-side paths', async () => {
    const res = await request(app.getHttpServer()).get('/some/view').expect(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  it('still serves the API as JSON', async () => {
    const res = await request(app.getHttpServer()).get('/api/system/info').expect(200);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('does not fall back to HTML for unknown API paths', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
