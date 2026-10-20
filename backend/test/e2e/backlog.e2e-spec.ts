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
    await api().post('/api/backlog/refresh').expect(200); // the user is read in the background at startup, a refresh fills it
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
    await api().post('/api/backlog/items/1/move').send({ from: 'backlog', to: 'nowhere' }).expect(400);
  });

  it('answers an unknown item with 404', async () => {
    await api().get('/api/backlog/items/999').expect(404);
    await api().post('/api/backlog/items/999/move').send({ from: 'backlog', to: 'doing' }).expect(404);
  });

  it('creates an item in a lane and in the default lane, answering 201', async () => {
    const res = await api().post('/api/backlog/items').send({ title: 'Created', description: 'Body', lane: 'doing' }).expect(201);
    expect(res.body).toMatchObject({ title: 'Created', description: 'Body', lane: 'doing' });
    expect(res.text).not.toContain(TOKEN);
    const plain = await api().post('/api/backlog/items').send({ title: 'Plain' }).expect(201);
    expect(plain.body.lane).toBe('backlog');
    expect((await api().get(`/api/backlog/items/${res.body.id}`)).body.title).toBe('Created');
    expect([...gitlab.issues.values()].find((i) => i.title === 'Created')!.labels).toEqual(['status::doing']);
  });

  it('validates the create body and rejects an unknown or closed lane with 400', async () => {
    await api().post('/api/backlog/items').send({ title: '' }).expect(400);
    await api().post('/api/backlog/items').send({}).expect(400);
    await api().post('/api/backlog/items').send({ title: 'x'.repeat(256) }).expect(400);
    await api().post('/api/backlog/items').send({ title: 'T', lane: 'nowhere' }).expect(400);
    const closed = await api().post('/api/backlog/items').send({ title: 'T', lane: 'done' }).expect(400);
    expect(closed.text).not.toContain(TOKEN);
    expect(gitlab.issues.size).toBe(2);
  });

  it('updates title, description and assignees, and unassigns with an empty list', async () => {
    await api().post('/api/backlog/refresh').expect(200);
    const { id } = await itemByTitle('First');
    const res = await api().patch(`/api/backlog/items/${id}`).send({ title: 'Renamed', description: 'New body', assignees: ['tester'] }).expect(200);
    expect(res.body).toMatchObject({ id, title: 'Renamed', description: 'New body', assignees: ['tester'], lane: 'backlog' });
    expect(res.text).not.toContain(TOKEN);
    const cleared = await api().patch(`/api/backlog/items/${id}`).send({ assignees: [] }).expect(200);
    expect(cleared.body.assignees).toEqual([]);
  });

  it('validates the update body: empty patch, empty title, unknown assignee are 400, unknown item 404', async () => {
    await api().post('/api/backlog/refresh').expect(200);
    const { id } = await itemByTitle('First');
    await api().patch(`/api/backlog/items/${id}`).send({}).expect(400);
    await api().patch(`/api/backlog/items/${id}`).send({ title: '' }).expect(400);
    await api().patch(`/api/backlog/items/${id}`).send({ assignees: 'tester' }).expect(400);
    await api().patch(`/api/backlog/items/${id}`).send({ assignees: ['ghost'] }).expect(400);
    await api().patch('/api/backlog/items/999').send({ title: 'x' }).expect(404);
  });

  it('answers create and update with 503 when the source is down', async () => {
    await api().post('/api/backlog/refresh').expect(200);
    const { id } = await itemByTitle('First');
    gitlab.forceStatus = 500;
    const created = await api().post('/api/backlog/items').send({ title: 'T' }).expect(503);
    const updated = await api().patch(`/api/backlog/items/${id}`).send({ title: 'T' }).expect(503);
    expect(created.text + updated.text).not.toContain(TOKEN);
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
