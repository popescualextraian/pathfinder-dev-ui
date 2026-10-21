import { act, renderHook } from '@testing-library/react';
import { ApiError } from '../../src/api/http';
import type { ScheduleRecord, ScheduleSummary } from '../../src/api/models';
import { useSchedule, useSchedules } from '../../src/state/use-schedules';
import * as api from '../../src/api/schedules-api';

jest.mock('../../src/api/schedules-api');
const m = api as jest.Mocked<typeof api>;

const base = {
  id: 's1', title: 'T', prompt: 'p', repository: 'r', when: { cron: '0 9 * * *' }, timeoutMinutes: 120,
  enabled: true, nextRunAt: null, createdAt: 'a', updatedAt: 'b',
};
const summary = (over: Partial<ScheduleSummary> = {}): ScheduleSummary => ({ ...base, ...over });
const record = (over: Partial<ScheduleRecord> = {}): ScheduleRecord => ({ ...base, results: [], ...over });
const flush = () => act(async () => {});

describe('useSchedules', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('loads, refreshes every 30 s and stops when unmounted', async () => {
    m.listSchedules.mockResolvedValue([summary()]);
    const { result, unmount } = renderHook(() => useSchedules());
    expect(result.current.loading).toBe(true);
    await flush();
    expect(result.current.schedules.map((s) => s.id)).toEqual(['s1']);
    expect(result.current.loading).toBe(false);
    m.listSchedules.mockResolvedValue([summary(), summary({ id: 's2' })]);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(result.current.schedules).toHaveLength(2);
    unmount();
    jest.advanceTimersByTime(60_000);
    expect(m.listSchedules).toHaveBeenCalledTimes(2);
  });

  it('keeps the data when a refresh fails and clears the error on the next success', async () => {
    m.listSchedules.mockResolvedValueOnce([summary()]).mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useSchedules());
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(result.current.error).toBe('down');
    expect(result.current.schedules).toHaveLength(1);
    m.listSchedules.mockResolvedValue([]);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(result.current.error).toBeNull();
  });

  it('run returns the result and reloads; a failure sets actionError', async () => {
    m.listSchedules.mockResolvedValue([summary()]);
    const { result } = renderHook(() => useSchedules());
    await flush();
    m.runSchedule.mockResolvedValue({ firedAt: 'x', trigger: 'manual', outcome: 'running', taskId: 'T-1' });
    let r: unknown;
    await act(async () => {
      r = await result.current.run('s1');
    });
    expect(r).toMatchObject({ outcome: 'running' });
    expect(m.listSchedules).toHaveBeenCalledTimes(2);
    m.runSchedule.mockRejectedValue(new ApiError(404, 'gone'));
    await act(async () => {
      r = await result.current.run('s1');
    });
    expect(r).toBeNull();
    expect(result.current.actionError).toBe('gone');
    expect(result.current.pending).toBe(false);
  });

  it('toggle replaces with the other fields unchanged; remove deletes and reloads', async () => {
    m.listSchedules.mockResolvedValue([summary({ ref: 'dev', lastResult: undefined })]);
    m.replaceSchedule.mockResolvedValue(record());
    m.removeSchedule.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSchedules());
    await flush();
    await act(async () => {
      expect(await result.current.toggle(result.current.schedules[0], false)).toBe(true);
    });
    expect(m.replaceSchedule).toHaveBeenCalledWith('s1', {
      title: 'T', prompt: 'p', repository: 'r', ref: 'dev', when: { cron: '0 9 * * *' }, timeoutMinutes: 120,
      enabled: false,
    });
    await act(async () => {
      expect(await result.current.remove('s1')).toBe(true);
    });
    expect(m.removeSchedule).toHaveBeenCalledWith('s1');
    expect(m.listSchedules).toHaveBeenCalledTimes(3);
  });
});

describe('useSchedule', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('loads with results and refreshes every 30 s', async () => {
    m.getSchedule.mockResolvedValue(record());
    const { result } = renderHook(() => useSchedule('s1'));
    await flush();
    expect(result.current.schedule?.id).toBe('s1');
    m.getSchedule.mockResolvedValue(
      record({ results: [{ firedAt: 'x', trigger: 'time', outcome: 'done', summary: 'ok' }] }),
    );
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(result.current.schedule?.results).toHaveLength(1);
  });

  it('reports notFound on 404', async () => {
    m.getSchedule.mockRejectedValue(new ApiError(404, 'no'));
    const { result } = renderHook(() => useSchedule('x'));
    await flush();
    expect(result.current).toMatchObject({ notFound: true, error: 'no', loading: false });
  });

  it('run reloads; toggle uses the loaded record and keeps the answer; remove reports success', async () => {
    m.getSchedule.mockResolvedValue(record());
    const { result } = renderHook(() => useSchedule('s1'));
    await flush();
    m.runSchedule.mockResolvedValue({ firedAt: 'x', trigger: 'manual', outcome: 'skipped', reason: 'cap' });
    await act(async () => {
      expect((await result.current.run())?.outcome).toBe('skipped');
    });
    expect(m.getSchedule).toHaveBeenCalledTimes(2);
    m.replaceSchedule.mockResolvedValue(record({ enabled: false }));
    await act(async () => {
      expect(await result.current.toggle(false)).toBe(true);
    });
    expect(m.replaceSchedule.mock.calls[0][1]).toMatchObject({ enabled: false, title: 'T' });
    expect(result.current.schedule?.enabled).toBe(false);
    m.removeSchedule.mockResolvedValue(undefined);
    await act(async () => {
      expect(await result.current.remove()).toBe(true);
    });
  });
});
