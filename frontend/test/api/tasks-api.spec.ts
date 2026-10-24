import {
  ApiError,
  addSession,
  answer,
  appLogs,
  listApps,
  listSessions,
  cancel,
  close,
  deleteTask,
  getTask,
  listTasks,
  restartApp,
  sendPrompt,
  startApp,
  startTask,
  stopApp,
} from '../../src/api/tasks-api';
import { listRepositories } from '../../src/api/repositories-api';

function mockFetch(status: number, body?: unknown) {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  global.fetch = fn;
  return fn;
}

describe('tasks-api', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lists and gets tasks', async () => {
    const fn = mockFetch(200, [{ id: 'T-1' }]);
    await expect(listTasks()).resolves.toEqual([{ id: 'T-1' }]);
    expect(fn).toHaveBeenCalledWith('/api/tasks', undefined);
    await getTask('T-1');
    expect(fn).toHaveBeenLastCalledWith('/api/tasks/T-1', undefined);
  });

  it('posts JSON for start, prompt and answer', async () => {
    const fn = mockFetch(201, { id: 'T-1' });
    await startTask({ prompt: 'hi', repository: 'r' });
    expect(fn).toHaveBeenLastCalledWith('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi', repository: 'r' }),
    });
    await sendPrompt('T-1', 'more');
    expect(fn.mock.calls.at(-1)[0]).toBe('/api/tasks/T-1/prompt');
    expect(JSON.parse(fn.mock.calls.at(-1)[1].body)).toEqual({ text: 'more' });
    await answer('T-1', { text: 'yes', question: 'q1' });
    expect(fn.mock.calls.at(-1)[0]).toBe('/api/tasks/T-1/answer');
    expect(JSON.parse(fn.mock.calls.at(-1)[1].body)).toEqual({
      text: 'yes',
      question: 'q1',
    });
  });

  it('posts without body for cancel and close', async () => {
    const fn = mockFetch(202, { id: 'T-1' });
    await cancel('T-1');
    expect(fn).toHaveBeenLastCalledWith('/api/tasks/T-1/cancel', {
      method: 'POST',
    });
    await close('T-1');
    expect(fn).toHaveBeenLastCalledWith('/api/tasks/T-1/close', {
      method: 'POST',
    });
  });

  it('deletes and resolves on 204', async () => {
    const fn = mockFetch(204);
    await expect(deleteTask('T-1')).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledWith('/api/tasks/T-1', { method: 'DELETE' });
  });

  it('throws ApiError with status and message from the body', async () => {
    mockFetch(409, { statusCode: 409, message: 'Task is closed', path: '/x' });
    const error = await sendPrompt('T-1', 'x').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe('Task is closed');
  });

  it('joins validation message lists', async () => {
    mockFetch(400, {
      statusCode: 400,
      message: ['prompt must not be empty', 'bad model'],
    });
    const error = await startTask({ prompt: '' }).catch((e) => e);
    expect(error.status).toBe(400);
    expect(error.message).toBe('prompt must not be empty, bad model');
  });

  it('falls back to a status message when the body is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('no json');
      },
    });
    const error = await listTasks().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toContain('502');
  });

  it('lists repositories', async () => {
    const fn = mockFetch(200, [{ name: 'a', url: 'u', default: true }]);
    await expect(listRepositories()).resolves.toHaveLength(1);
    expect(fn).toHaveBeenCalledWith('/api/repositories', undefined);
  });

  it('app calls: list, start, stop, restart, logs', async () => {
    const fn = mockFetch(202, { name: 'web' });
    await listApps('T-1');
    expect(fn).toHaveBeenLastCalledWith('/api/tasks/T-1/apps', undefined);
    await startApp('T-1', 'web');
    expect(fn).toHaveBeenLastCalledWith('/api/tasks/T-1/apps/web/start', { method: 'POST' });
    await stopApp('T-1', 'web');
    expect(fn).toHaveBeenLastCalledWith('/api/tasks/T-1/apps/web/stop', { method: 'POST' });
    await restartApp('T-1', 'web');
    expect(fn).toHaveBeenLastCalledWith('/api/tasks/T-1/apps/web/restart', { method: 'POST' });
    await appLogs('T-1', 'web', 50);
    expect(fn).toHaveBeenLastCalledWith('/api/tasks/T-1/apps/web/logs?lines=50', undefined);
  });
});

describe('tasks-api sessions', () => {
  afterEach(() => jest.restoreAllMocks());

  it('adds and lists sessions', async () => {
    const fn = mockFetch(201, { id: 'T-1' });
    await addSession('T-1', { name: 'second', forkFrom: 'main', prompt: 'go' });
    expect(fn.mock.calls.at(-1)[0]).toBe('/api/tasks/T-1/sessions');
    expect(fn.mock.calls.at(-1)[1].method).toBe('POST');
    expect(JSON.parse(fn.mock.calls.at(-1)[1].body)).toEqual({
      name: 'second',
      forkFrom: 'main',
      prompt: 'go',
    });
    await listSessions('T-1');
    expect(fn).toHaveBeenLastCalledWith('/api/tasks/T-1/sessions', undefined);
  });

  it('sends session with prompt, answer and cancel only when given', async () => {
    const fn = mockFetch(202, { id: 'T-1' });
    await sendPrompt('T-1', 'hi', 'second');
    expect(JSON.parse(fn.mock.calls.at(-1)[1].body)).toEqual({
      text: 'hi',
      session: 'second',
    });
    await sendPrompt('T-1', 'hi');
    expect(JSON.parse(fn.mock.calls.at(-1)[1].body)).toEqual({ text: 'hi' });
    await cancel('T-1', 'second');
    expect(fn.mock.calls.at(-1)[0]).toBe('/api/tasks/T-1/cancel');
    expect(JSON.parse(fn.mock.calls.at(-1)[1].body)).toEqual({
      session: 'second',
    });
    await answer('T-1', { text: 'yes', session: 'second' });
    expect(JSON.parse(fn.mock.calls.at(-1)[1].body)).toEqual({
      text: 'yes',
      session: 'second',
    });
  });
});
