import { getItems, getLanes, moveItem, refreshBacklog, setFileLinks } from '../../src/api/backlog-api';
import { ApiError } from '../../src/api/http';

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

describe('backlog-api', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('getLanes returns the response', async () => {
    fetchMock.mockReturnValue(json(200, { me: 'u', lanes: [{ id: 'a', title: 'A' }] }));
    expect(await getLanes()).toEqual({ me: 'u', lanes: [{ id: 'a', title: 'A' }] });
    expect(fetchMock).toHaveBeenCalledWith('/api/backlog/lanes', undefined);
  });

  it('getLanes returns null on 404 and rethrows other errors', async () => {
    fetchMock.mockReturnValue(json(404, { message: 'off' }));
    expect(await getLanes()).toBeNull();
    fetchMock.mockReturnValue(json(500, { message: 'bad' }));
    await expect(getLanes()).rejects.toBeInstanceOf(ApiError);
  });

  it('getItems and refreshBacklog', async () => {
    fetchMock.mockReturnValue(json(200, [{ id: '1' }]));
    expect(await getItems()).toEqual([{ id: '1' }]);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/backlog/items', undefined);
    await refreshBacklog();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/backlog/refresh', { method: 'POST' });
  });

  it('moveItem posts from and to', async () => {
    fetchMock.mockReturnValue(json(200, { id: 'a/b#1' }));
    await moveItem('a/b#1', 'x', 'y');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/backlog/items/a%2Fb%231/move');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ from: 'x', to: 'y' });
  });

  it('setFileLinks puts links', async () => {
    fetchMock.mockReturnValue(json(200, [{ repo: 'r', path: 'p' }]));
    await setFileLinks('1', [{ repo: 'r', path: 'p' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/backlog/items/1/file-links');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ links: [{ repo: 'r', path: 'p' }] });
  });
});
