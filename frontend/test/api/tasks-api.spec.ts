import { ApiError, answer, cancel, close, deleteTask, getTask, listTasks, sendPrompt, startTask } from '../../src/api/tasks-api';
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
    expect(JSON.parse(fn.mock.calls.at(-1)[1].body)).toEqual({ text: 'yes', question: 'q1' });
  });

  it('posts without body for cancel and close', async () => {
    const fn = mockFetch(202, { id: 'T-1' });
    await cancel('T-1');
    expect(fn).toHaveBeenLastCalledWith('/api/tasks/T-1/cancel', { method: 'POST' });
    await close('T-1');
    expect(fn).toHaveBeenLastCalledWith('/api/tasks/T-1/close', { method: 'POST' });
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
    mockFetch(400, { statusCode: 400, message: ['prompt must not be empty', 'bad model'] });
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
});
