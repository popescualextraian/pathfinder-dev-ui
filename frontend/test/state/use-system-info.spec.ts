import { renderHook, waitFor } from '@testing-library/react';
import { fetchSystemInfo } from '../../src/api/system-api';
import { useSystemInfo } from '../../src/state/use-system-info';

jest.mock('../../src/api/system-api');
const fetchMock = jest.mocked(fetchSystemInfo);

describe('useSystemInfo', () => {
  it('starts loading and then holds the data', async () => {
    const info = { name: 'app', version: '1.0.0', uptimeSeconds: 3 };
    fetchMock.mockResolvedValue(info);

    const { result } = renderHook(() => useSystemInfo());

    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current).toEqual({ status: 'success', data: info }));
  });

  it('holds the error when the call fails', async () => {
    fetchMock.mockRejectedValue(new Error('nope'));

    const { result } = renderHook(() => useSystemInfo());

    await waitFor(() => expect(result.current).toEqual({ status: 'error', message: 'nope' }));
  });
});
