import { INestApplication } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { FakeGitlab } from '../helpers/fake-gitlab';
import { openSse } from '../helpers/sse-client';
import { createApp } from './create-app';

jest.setTimeout(20_000);

const TOKEN = 'glpat-made-up-backlog-token-4711';

describe('backlog API (e2e)', () => {
  let gitlab: FakeGitlab;
  let app: INestApplication;
  let dataDir: string;
  const api = () => request(app.getHttpServer());
  const itemByTitle = async (title: string) =>
    (await api().get('/api/backlog/items')).body.find((i: { title: string }) => i.title === title);

  beforeEach(async () => {
    gitlab = new FakeGitlab(TOKEN);
    await gitlab.start();
    gitlab.addIssue({ title: 'First', labels: ['status::backlog'] });
    gitlab.addIssue({ title: 'Second', labels: ['status::doing'] });
    ({ app, dataDir } = await createApp({ backlog: { gitlab } }));
  });
  afterEach(async () => {
    await app.close();
    await gitlab.stop();
  });

  it('shows lane ids and titles, and no mapping, trigger or token', async () => {
    const res = await api().get('/api/backlog/lanes').expect(200);
    expect(res.body).toEqual({
      me: 'tester',
      lanes: [{ id: 'backlog', title: 'Backlog' }, { id: 'doing', title: 'Doing' }, { id: 'done', title: 'Done' }],
    });
    expect(res.text).not.toContain(TOKEN);
    expect(res.text).not.toContain('start-work');
    expect(res.text).not.toContain('status::');
  });

  it('lists the items after a refresh and gets one', async () => {
    const refreshed = await api().post('/api/backlog/refresh').expect(200);
    expect(refreshed.body.map((i: { title: string }) => i.title).sort()).toEqual(['First', 'Second']);
    const list = await api().get('/api/backlog/items').expect(200);
    expect(list.body).toHaveLength(2);
    const one = await api().get(`/api/backlog/items/${list.body[0].id}`).expect(200);
    expect(one.body.id).toBe(list.body[0].id);
  });

  it('moves an item and announces it on the stream', async () => {
    await api().post('/api/backlog/refresh').expect(200);
    const first = await itemByTitle('First');
    const stream = openSse(app, '/api/backlog/stream');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const res = await api().post(`/api/backlog/items/${first.id}/move`).send({ from: 'backlog', to: 'doing' }).expect(200);
    expect(res.body.lane).toBe('doing');
    const event = await stream.next((e) => e.event === 'item' && e.data.id === first.id);
    expect(event.data.lane).toBe('doing');
    expect(stream.status).toBe(200);
    expect(stream.type).toMatch(/text\/event-stream/);
    stream.close();
  });

  it('answers a move from a stale lane with 409', async () => {
    await api().post('/api/backlog/refresh').expect(200);
    const first = await itemByTitle('First');
    const res = await api().post(`/api/backlog/items/${first.id}/move`).send({ from: 'doing', to: 'done' }).expect(409);
    expect(res.body.message).toBeDefined();
  });

  it('validates the move body and the target lane', async () => {
    await api().post('/api/backlog/items/1/move').send({ from: '', to: 'doing' }).expect(400);
    await api().post('/api/backlog/items/1/move').send({ from: 'backlog' }).expect(400);
    await api().post('/api/backlog/items/1/move').send({ from: 'backlog', to: 'nowhere' }).expect(404);
  });

  it('answers an unknown item with 404', async () => {
    await api().get('/api/backlog/items/999').expect(404);
    await api().post('/api/backlog/items/999/move').send({ from: 'backlog', to: 'doing' }).expect(404);
  });

  it('sets file links', async () => {
    await api().post('/api/backlog/refresh').expect(200);
    const { id } = await itemByTitle('First');
    const links = [{ repo: 'acme/app', path: 'src/a.ts', ref: 'main', note: 'entry' }];
    const res = await api().put(`/api/backlog/items/${id}/file-links`).send({ links }).expect(200);
    expect(res.body).toEqual(links);
    expect((await api().get(`/api/backlog/items/${id}`)).body.fileLinks).toEqual(links);
    await api().put(`/api/backlog/items/${id}/file-links`).send({ links: [{ repo: 'x' }] }).expect(400);
  });

  it('answers 503 on refresh when the source is down, and still lists from the cache', async () => {
    await api().post('/api/backlog/refresh').expect(200);
    gitlab.forceStatus = 500;
    const res = await api().post('/api/backlog/refresh').expect(503);
    expect(res.text).not.toContain(TOKEN);
    const list = await api().get('/api/backlog/items').expect(200);
    expect(list.body).toHaveLength(2);
  });

  it('never exposes the token in a response, in an event or in the cache file', async () => {
    const stream = openSse(app, '/api/backlog/stream');
    const bodies: string[] = [];
    bodies.push((await api().post('/api/backlog/refresh')).text);
    const list = await api().get('/api/backlog/items');
    bodies.push(list.text, (await api().get('/api/backlog/lanes')).text);
    bodies.push((await api().post(`/api/backlog/items/${list.body[0].id}/move`).send({ from: 'x', to: 'done' })).text);
    gitlab.forceStatus = 500;
    bodies.push((await api().post('/api/backlog/refresh')).text);
    await stream.next((e) => e.event === 'error');
    expect(JSON.stringify(stream.events)).not.toContain(TOKEN);
    stream.close();
    for (const body of bodies) expect(body).not.toContain(TOKEN);
    const cacheDir = join(dataDir, 'backlog');
    expect(existsSync(cacheDir)).toBe(true);
    for (const file of readdirSync(cacheDir)) expect(readFileSync(join(cacheDir, file), 'utf8')).not.toContain(TOKEN);
  });
});

describe('backlog API switched off (e2e)', () => {
  it('is a 404 without BACKLOG_CONFIG', async () => {
    const { app } = await createApp();
    try {
      await request(app.getHttpServer()).get('/api/backlog/lanes').expect(404);
      await request(app.getHttpServer()).get('/api/backlog/items').expect(404);
    } finally {
      await app.close();
    }
  });
});
