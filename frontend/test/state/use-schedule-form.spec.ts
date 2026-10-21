import { act, renderHook } from '@testing-library/react';
import { ApiError } from '../../src/api/http';
import type { ScheduleRecord, ScheduleWhen } from '../../src/api/models';
import { useSchedulePreview, useScheduleSave } from '../../src/state/use-schedule-form';
import * as api from '../../src/api/schedules-api';

jest.mock('../../src/api/schedules-api');
const m = api as jest.Mocked<typeof api>;
const flush = () => act(async () => {});

const input = { title: 'T', prompt: 'p', repository: 'r', when: { cron: '0 9 * * *' } };
const record = { ...input, id: 't', timeoutMinutes: 120, enabled: true, nextRunAt: null, createdAt: 'a', updatedAt: 'b', results: [] } as ScheduleRecord;

describe('useSchedulePreview', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('asks after the delay, once for a burst of changes, and keeps the zone', async () => {
    m.previewSchedule.mockResolvedValue({ zone: 'UTC', next: ['2026-10-22T09:00:00+00:00'] });
    const { result, rerender } = renderHook(({ when }: { when: ScheduleWhen | null }) => useSchedulePreview(when, 400), {
      initialProps: { when: { cron: '0 8 * * *' } as ScheduleWhen | null },
    });
    rerender({ when: { cron: '0 9 * * *' } });
    expect(m.previewSchedule).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(m.previewSchedule).toHaveBeenCalledTimes(1);
    expect(m.previewSchedule).toHaveBeenCalledWith({ cron: '0 9 * * *' });
    expect(result.current).toMatchObject({ zone: 'UTC', next: ['2026-10-22T09:00:00+00:00'], error: null });
  });

  it('shows the error of an invalid when and asks nothing without one', async () => {
    m.previewSchedule.mockRejectedValue(new ApiError(400, 'cron does not parse', { field: 'when.cron' }));
    const { result, rerender } = renderHook(({ when }: { when: ScheduleWhen | null }) => useSchedulePreview(when, 0), {
      initialProps: { when: { cron: 'x' } as ScheduleWhen | null },
    });
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(result.current.error).toBe('cron does not parse');
    expect(result.current.next).toEqual([]);
    rerender({ when: null });
    await flush();
    expect(result.current.error).toBeNull();
    expect(m.previewSchedule).toHaveBeenCalledTimes(1);
  });
});

describe('useScheduleSave', () => {
  beforeEach(() => jest.resetAllMocks());

  it('creates without an id and replaces with one', async () => {
    m.createSchedule.mockResolvedValue(record);
    m.replaceSchedule.mockResolvedValue(record);
    const { result } = renderHook(() => useScheduleSave());
    let saved: ScheduleRecord | null = null;
    await act(async () => {
      saved = await result.current.save(null, input);
    });
    expect(saved).toBe(record);
    expect(m.createSchedule).toHaveBeenCalledWith(input);
    await act(async () => {
      await result.current.save('t', input);
    });
    expect(m.replaceSchedule).toHaveBeenCalledWith('t', input);
  });

  it('keeps the error and its field', async () => {
    m.createSchedule.mockRejectedValue(new ApiError(400, 'title is required', { field: 'title' }));
    const { result } = renderHook(() => useScheduleSave());
    let saved: ScheduleRecord | null = record;
    await act(async () => {
      saved = await result.current.save(null, input);
    });
    expect(saved).toBeNull();
    expect(result.current).toMatchObject({ error: 'title is required', field: 'title', pending: false });
  });
});
