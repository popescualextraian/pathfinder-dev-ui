import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from './create-app';
import pkg from '../../../package.json';

describe('GET /api/system/info (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = (await createApp()).app;
  });
  afterAll(() => app.close());

  it('returns name, version and uptimeSeconds', async () => {
    const res = await request(app.getHttpServer()).get('/api/system/info').expect(200);
    expect(res.body).toEqual({
      name: pkg.name,
      version: pkg.version,
      uptimeSeconds: expect.any(Number),
    });
  });

  it('answers unknown API routes with the JSON error shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, path: '/api/nope' });
  });
});
