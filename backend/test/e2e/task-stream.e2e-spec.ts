import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeBridge } from '../helpers/fake-bridge';
import { FakeLauncher } from '../helpers/fake-launcher';
import { openSse } from '../helpers/sse-client';
import { createApp } from './create-app';

jest.setTimeout(20_000);

// The status stream (GET /api/tasks/stream) and the poller behind it, with a fake bridge and a poll
// interval of one second.
describe('status stream and poller (e2e)', () => {
  let app: INestApplication;
  let bridge: FakeBridge;
  let launcher: FakeLauncher;
  let stream: ReturnType<typeof openSse>;

  const api = () => request(app.getHttpServer());

  const open = (path?: string) => openSse(app, path);

  beforeEach(async () => {
    bridge = new FakeBridge();
    await bridge.start();
    launcher = new FakeLauncher(bridge.url);
    ({ app } = await createApp({ launcher, env: { ENGINE_POLL_SECONDS: '1' } }));
    stream = open();
    await stream.next(() => true, 50).catch(() => undefined); // let the connection open
  });
  afterEach(async () => {
    stream.close();
    await app.close();
    await bridge.stop();
  });

  it('is an event stream, and replays nothing on connect', async () => {
    await api().post('/api/tasks').send({ prompt: 'before' });
    const late = open();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(late.status).toBe(200);
    expect(late.type).toMatch(/text\/event-stream/);
    expect(late.events).toEqual([]);
    late.close();
  });

  it('announces a new task, then the changes the poller finds, without any read call', async () => {
    const created = await api().post('/api/tasks').send({ prompt: 'work' });
    const id = created.body.id as string;
    await stream.next((e) => e.event === 'task' && e.data.id === id);
    expect(stream.status).toBe(200);

    await api().post(`/api/tasks/${id}/prompt`).send({ text: 'go on' }); // the fake bridge now runs
    const reads = () => bridge.requests.filter((r) => r.method === 'GET' && r.url === '/status').length;
    const readsBefore = reads();

    const text = 'A long answer. '.repeat(40);
    bridge.state = 'idle';
    bridge.emit('message', { role: 'agent', text, final: true });
    bridge.emit('state', { state: 'idle', reason: '' });
    const idle = await stream.next((e) => e.event === 'task' && e.data.id === id && e.data.state === 'idle' && e.data.lastMessage === text);
    expect(idle.data).toMatchObject({ section: 'in-review', closed: false, questions: [] });
    expect(idle.data).not.toHaveProperty('taskToken');

    // The record itself has it: the list reads records only.
    const list = await api().get('/api/tasks');
    expect(list.body[0]).toMatchObject({ id, state: 'idle', lastMessage: text });
    expect(reads()).toBe(readsBefore);
  });

  it('shows an open question under needs-you and its answer', async () => {
    const id = (await api().post('/api/tasks').send({ prompt: 'work' })).body.id as string;
    await api().post(`/api/tasks/${id}/prompt`).send({ text: 'ask me' });
    bridge.ask('Q1', 'Which file?', '2026-10-17T10:00:00Z');
    const waiting = await stream.next((e) => e.event === 'task' && e.data.id === id && e.data.section === 'needs-you');
    expect(waiting.data.questions).toEqual([expect.objectContaining({ id: 'Q1', text: 'Which file?', source: 'ask' })]);

    const answered = await api().post(`/api/tasks/${id}/answer`).send({ text: 'a.ts', question: 'Q1' });
    expect(answered.status).toBe(202);
    const running = await stream.next((e) => e.event === 'task' && e.data.id === id && e.data.state === 'running' && e.data.questions.length === 0);
    expect(running.data.section).toBe('working');
  });

  it('announces close, and removal of a deleted task', async () => {
    const id = (await api().post('/api/tasks').send({ prompt: 'work' })).body.id as string;
    await api().post(`/api/tasks/${id}/close`);
    await stream.next((e) => e.event === 'task' && e.data.id === id && e.data.closed === true && e.data.section === 'done');
    await api().delete(`/api/tasks/${id}`);
    const removed = await stream.next((e) => e.event === 'removed');
    expect(removed.data).toEqual({ id });
  });

  it('is not taken for a task id', async () => {
    const res = await api().get('/api/tasks/not-an-id');
    expect(res.status).toBe(404);
  });
});
