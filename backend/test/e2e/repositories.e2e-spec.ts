import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeBridge } from '../helpers/fake-bridge';
import { FakeLauncher } from '../helpers/fake-launcher';
import { createApp } from './create-app';

describe('repositories and titles (e2e)', () => {
  let app: INestApplication;
  let bridge: FakeBridge;
  let launcher: FakeLauncher;
  const api = () => request(app.getHttpServer());

  beforeEach(async () => {
    bridge = new FakeBridge();
    await bridge.start();
    launcher = new FakeLauncher(bridge.url);
    ({ app } = await createApp({
      launcher,
      env: { ENGINE_REPOS: JSON.stringify([{ name: 'docs', url: 'https://gitlab.com/acme/docs.git' }]) },
    }));
  });
  afterEach(async () => {
    await app.close();
    await bridge.stop();
  });

  it('GET /api/repositories lists the default first, then ENGINE_REPOS', async () => {
    const res = await api().get('/api/repositories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { name: 'default', url: 'https://github.com/acme/default.git', default: true },
      { name: 'docs', url: 'https://gitlab.com/acme/docs.git', default: false },
    ]);
  });

  it('starts a task in a named repository (its host is allowed because it is listed)', async () => {
    const res = await api().post('/api/tasks').send({ prompt: 'p', repository: 'docs' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ repository: 'docs', repoUrl: 'https://gitlab.com/acme/docs.git' });
    expect(launcher.specs[0].repoUrl).toBe('https://gitlab.com/acme/docs.git');
  });

  it('starts in the default repository when neither repository nor repoUrl is given', async () => {
    const res = await api().post('/api/tasks').send({ prompt: 'p' });
    expect(res.body).toMatchObject({ repository: 'default', repoUrl: 'https://github.com/acme/default.git' });
  });

  it.each([
    ['an unknown repository', { prompt: 'p', repository: 'nope' }],
    ['repository and repoUrl together', { prompt: 'p', repository: 'docs', repoUrl: 'https://github.com/acme/default.git' }],
    ['a bad repository name', { prompt: 'p', repository: 'a b' }],
  ])('answers 400 for %s and launches nothing', async (_label, body) => {
    const res = await api().post('/api/tasks').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ statusCode: 400, path: '/api/tasks' });
    expect(launcher.specs).toHaveLength(0);
  });

  it('keeps a given title and derives the default from the prompt, which stays whole', async () => {
    const given = await api().post('/api/tasks').send({ prompt: 'p', title: 'My title' });
    expect(given.body.title).toBe('My title');
    const prompt = `${'x'.repeat(120)}\nsecond line`;
    const derived = await api().post('/api/tasks').send({ prompt });
    expect(derived.body.title).toHaveLength(80);
    expect(derived.body.prompt).toBe(prompt);
    const list = await api().get('/api/tasks');
    expect(list.body.map((t: { title: string }) => t.title)).toEqual(expect.arrayContaining(['My title', derived.body.title]));
  });
});
