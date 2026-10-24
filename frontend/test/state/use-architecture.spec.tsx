import { act, renderHook } from '@testing-library/react';
import { ApiError } from '../../src/api/http';
import * as api from '../../src/api/architecture-api';
import {
  useArchitecture, useArchitectureReviews, useArchitectureStatus, useReviewDetail,
} from '../../src/state/use-architecture';

jest.mock('../../src/api/architecture-api');
const m = api as jest.Mocked<typeof api>;
const flush = () => act(async () => {});
const arch = (repository: string) => ({ repository }) as never;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('use-architecture', () => {
  beforeEach(() => jest.resetAllMocks());

  it('status: enabled with repositories, disabled on null or failure', async () => {
    m.getArchitectureStatus.mockResolvedValue({ repositories: ['a', 'b'] });
    const on = renderHook(() => useArchitectureStatus());
    expect(on.result.current.loading).toBe(true);
    await flush();
    expect(on.result.current).toEqual({ enabled: true, repositories: ['a', 'b'], loading: false });
    m.getArchitectureStatus.mockResolvedValue(null);
    const off = renderHook(() => useArchitectureStatus());
    await flush();
    expect(off.result.current).toEqual({ enabled: false, repositories: [], loading: false });
    m.getArchitectureStatus.mockRejectedValue(new Error('x'));
    const bad = renderHook(() => useArchitectureStatus());
    await flush();
    expect(bad.result.current.enabled).toBe(false);
    expect(bad.result.current.loading).toBe(false);
  });

  it('loads, reports errors and notFound', async () => {
    m.getArchitecture.mockResolvedValue(arch('a'));
    const ok = renderHook(() => useArchitecture('a'));
    expect(ok.result.current.loading).toBe(true);
    await flush();
    expect(ok.result.current).toMatchObject({ loading: false, error: null, notFound: false, data: { repository: 'a' } });
    m.getArchitecture.mockRejectedValue(new ApiError(404, 'none'));
    const nf = renderHook(() => useArchitecture('b'));
    await flush();
    expect(nf.result.current).toMatchObject({ notFound: true, error: 'none', data: null });
    m.getArchitecture.mockRejectedValue(new ApiError(502, 'down'));
    const bad = renderHook(() => useArchitecture('c'));
    await flush();
    expect(bad.result.current).toMatchObject({ notFound: false, error: 'down' });
  });

  it('a stale response of the previous repository does not overwrite the newer one', async () => {
    const first = deferred<never>();
    m.getArchitecture.mockReturnValueOnce(first.promise);
    m.getArchitecture.mockResolvedValueOnce(arch('b'));
    const { result, rerender } = renderHook(({ r }) => useArchitecture(r), { initialProps: { r: 'a' } });
    rerender({ r: 'b' });
    await flush();
    expect(result.current.data).toMatchObject({ repository: 'b' });
    await act(async () => first.resolve(arch('a')));
    expect(result.current.data).toMatchObject({ repository: 'b' });
  });

  it('reviews and review detail', async () => {
    m.listReviews.mockResolvedValue({ repository: 'a', reviews: [] } as never);
    const list = renderHook(() => useArchitectureReviews('a'));
    await flush();
    expect(list.result.current.list).toMatchObject({ repository: 'a' });
    m.getReview.mockResolvedValue({ slug: 's' } as never);
    const detail = renderHook(() => useReviewDetail('a', 'feature/x', 's'));
    await flush();
    expect(m.getReview).toHaveBeenCalledWith('a', 'feature/x', 's');
    expect(detail.result.current.data).toMatchObject({ slug: 's' });
    m.getReview.mockRejectedValue(new ApiError(404, 'no'));
    const gone = renderHook(() => useReviewDetail('a', 'feature/x', 'nope'));
    await flush();
    expect(gone.result.current).toMatchObject({ notFound: true });
  });
});
