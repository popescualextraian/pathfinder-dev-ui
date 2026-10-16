import { fetchSystemInfo } from './system-api';

describe('fetchSystemInfo', () => {
  afterEach(() => jest.restoreAllMocks());

  it('gets /api/system/info and returns the parsed body', async () => {
    const info = { name: 'app', version: '1.0.0', uptimeSeconds: 3 };
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => info });
    global.fetch = fetchMock;

    await expect(fetchSystemInfo()).resolves.toEqual(info);
    expect(fetchMock).toHaveBeenCalledWith('/api/system/info');
  });

  it('rejects when the response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(fetchSystemInfo()).rejects.toThrow('500');
  });
});
