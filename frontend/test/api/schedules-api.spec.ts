import {
  createSchedule, getSchedule, listSchedules, previewSchedule, removeSchedule, replaceSchedule, runSchedule,
} from '../../src/api/schedules-api';
import { ApiError } from '../../src/api/http';

const json = (status: number, body?: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

const input = { title: 'T', prompt: 'p', repository: 'r', when: { cron: '0 9 * * *' } };

describe('schedules-api', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('lists and gets', async () => {
    fetchMock.mockReturnValue(json(200, []));
    expect(await listSchedules()).toEqual([]);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/schedules', undefined);
    fetchMock.mockReturnValue(json(200, { id: 'a/b' }));
    await getSchedule('a/b');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/schedules/a%2Fb', undefined);
  });

  it('creates with a POST body', async () => {
    fetchMock.mockReturnValue(json(201, { id: 's1' }));
    await createSchedule(input);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/schedules');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(input);
  });

  it('replaces with PUT, removes with DELETE (204)', async () => {
    fetchMock.mockReturnValue(json(200, { id: 's1' }));
    await replaceSchedule('s1', input);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/schedules/s1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual(input);
    fetchMock.mockReturnValue(json(204));
    expect(await removeSchedule('s1')).toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/schedules/s1', { method: 'DELETE' });
  });

  it('runs without a body and previews with when', async () => {
    fetchMock.mockReturnValue(json(202, { outcome: 'running' }));
    expect(await runSchedule('s1')).toEqual({ outcome: 'running' });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/schedules/s1/run', { method: 'POST' });
    fetchMock.mockReturnValue(json(200, { zone: 'UTC', next: [] }));
    await previewSchedule({ at: '2026-01-01T10:00' });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/schedules/preview');
    expect(JSON.parse(init.body)).toEqual({ when: { at: '2026-01-01T10:00' } });
  });

  it('turns a 400 field into ApiError.location.field', async () => {
    fetchMock.mockReturnValue(json(400, { statusCode: 400, message: 'bad cron', field: 'when.cron' }));
    const e = (await createSchedule(input).catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 400, message: 'bad cron', location: { field: 'when.cron' } });
  });
});
