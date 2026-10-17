import { renderHook, waitFor } from '@testing-library/react';
import { useTask } from '../../src/state/use-task';
import * as api from '../../src/api/tasks-api';
import { makeTask } from '../fixtures/tasks';

jest.mock('../../src/api/tasks-api');
const getTask = api.getTask as jest.Mock;

describe('useTask', () => {
  it('loads, then follows the live list', async () => {
    const t = makeTask({ updatedAt: '2026-10-17T10:00:00Z' });
    getTask.mockResolvedValue(t);
    const { result, rerender } = renderHook(({ live }) => useTask('T-1', live), {
      initialProps: { live: [] as (typeof t)[] },
    });
    await waitFor(() => expect(result.current.task?.id).toBe('T-1'));
    rerender({
      live: [{ ...t, state: 'waiting', updatedAt: '2026-10-17T10:05:00Z' }],
    });
    expect(result.current.task?.state).toBe('waiting');
  });
  it('reports a load error', async () => {
    getTask.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useTask('T-9'));
    await waitFor(() => expect(result.current.error).toBe('nope'));
  });
  it('does nothing without an id', () => {
    const { result } = renderHook(() => useTask(null));
    expect(result.current.task).toBeNull();
  });
});
