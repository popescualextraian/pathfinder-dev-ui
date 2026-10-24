import { getArchitecture, getArchitectureStatus, getReview, listReviews } from '../../src/api/architecture-api';

const json = (status: number, body?: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

describe('architecture-api', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('status: the body, or null on 404', async () => {
    fetchMock.mockReturnValue(json(200, { repositories: ['a'] }));
    expect(await getArchitectureStatus()).toEqual({ repositories: ['a'] });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/architecture/status', undefined);
    fetchMock.mockReturnValue(json(404, { message: 'x' }));
    expect(await getArchitectureStatus()).toBeNull();
    fetchMock.mockReturnValue(json(500, { message: 'boom' }));
    await expect(getArchitectureStatus()).rejects.toThrow('boom');
  });

  it('builds the urls', async () => {
    fetchMock.mockReturnValue(json(200, {}));
    await getArchitecture();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/architecture', undefined);
    await getArchitecture('a b');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/architecture?repository=a%20b', undefined);
    await listReviews('x');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/architecture/reviews?repository=x', undefined);
    await listReviews();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/architecture/reviews', undefined);
    await getReview('x', 'feature/gift-cards', '2026-10-20-gift-cards');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/architecture/reviews/feature%2Fgift-cards/2026-10-20-gift-cards?repository=x',
      undefined,
    );
  });
});
