import { act, renderHook, waitFor } from '@testing-library/react';
import { useWorkflowRuns } from '../../src/state/use-workflow-runs';
import * as api from '../../src/api/workflows-api';
import { FakeEventSource } from '../api/fake-event-source';
import { makeRun } from '../fixtures/workflows';

jest.mock('../../src/api/workflows-api');
const listRuns = api.listRuns as jest.Mock;
const startRun = api.startRun as jest.Mock;
const advanceRun = api.advanceRun as jest.Mock;
const stopRun = api.stopRun as jest.Mock;

const run1 = makeRun({ id: 'R-1', itemId: '7', taskId: 'T-1', createdAt: '2026-10-20T10:00:00Z' });

describe('useWorkflowRuns', () => {
  beforeEach(() => {
    FakeEventSource.install();
    [listRuns, startRun, advanceRun, stopRun].forEach((m) => m.mockReset());
    listRuns.mockResolvedValue([run1]);
  });

  it('does nothing while disabled', async () => {
    const { result } = renderHook(() => useWorkflowRuns(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listRuns).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.runs).toEqual([]);
  });

  it('loads, applies stream updates, reloads on reconnect', async () => {
    const { result } = renderHook(() => useWorkflowRuns(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(FakeEventSource.last.url).toBe('/api/workflow-runs/stream');
    expect(result.current.runs.map((r) => r.id)).toEqual(['R-1']);

    act(() => FakeEventSource.last.emit('run', { ...run1, state: 'awaiting-approval', updatedAt: '2026-10-20T11:00:00Z' }));
    expect(result.current.runs[0].state).toBe('awaiting-approval');
    // an older copy does not win
    act(() => FakeEventSource.last.emit('run', run1));
    expect(result.current.runs[0].state).toBe('awaiting-approval');

    const run2 = makeRun({ id: 'R-2', itemId: '8', createdAt: '2026-10-20T12:00:00Z', updatedAt: '2026-10-20T12:00:00Z' });
    listRuns.mockClear();
    listRuns.mockResolvedValue([run1, run2]);
    act(() => FakeEventSource.last.emit('open'));
    await waitFor(() => expect(result.current.runs.map((r) => r.id)).toEqual(['R-1', 'R-2']));
    expect(listRuns).toHaveBeenCalledTimes(1);
  });

  it('keeps a stream run seen while the load is in flight', async () => {
    let resolve!: (l: unknown[]) => void;
    listRuns.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useWorkflowRuns(true));
    const fresh = makeRun({ id: 'R-9', itemId: '9', createdAt: '2026-10-20T13:00:00Z', updatedAt: '2026-10-20T13:00:00Z' });
    act(() => FakeEventSource.last.emit('run', fresh));
    await act(async () => resolve([run1]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs.map((r) => r.id).sort()).toEqual(['R-1', 'R-9']);
  });

  it('runsByItem prefers the active run, else the most recent; runByTask likewise', async () => {
    const done = makeRun({ id: 'R-old', itemId: '7', taskId: 'T-old', state: 'done', createdAt: '2026-10-19T10:00:00Z' });
    const stopped = makeRun({ id: 'R-new', itemId: '8', taskId: 'T-8', state: 'stopped', createdAt: '2026-10-20T09:00:00Z' });
    const failed = makeRun({ id: 'R-mid', itemId: '8', taskId: 'T-8b', state: 'failed', createdAt: '2026-10-20T08:00:00Z' });
    listRuns.mockResolvedValue([done, run1, failed, stopped]);
    const { result } = renderHook(() => useWorkflowRuns(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runsByItem.get('7')?.id).toBe('R-1');
    expect(result.current.runsByItem.get('8')?.id).toBe('R-new');
    expect(result.current.runsByItem.get('nope')).toBeUndefined();
    expect(result.current.runByTask('T-old')?.id).toBe('R-old');
    expect(result.current.runByTask('T-1')?.id).toBe('R-1');
    expect(result.current.runByTask('T-x')).toBeUndefined();
  });

  it('start applies the returned run and tracks pending per item', async () => {
    listRuns.mockResolvedValue([]);
    let resolve!: (r: unknown) => void;
    startRun.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useWorkflowRuns(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let done!: Promise<unknown>;
    act(() => {
      done = result.current.start('7', 'wf');
    });
    expect(result.current.actionState('7').pending).toBe(true);
    expect(result.current.actionState('8').pending).toBe(false);
    await act(async () => {
      resolve(run1);
      await done;
    });
    expect(startRun).toHaveBeenCalledWith('7', 'wf');
    expect(result.current.actionState('7')).toEqual({ pending: false, error: null });
    expect(result.current.runsByItem.get('7')?.id).toBe('R-1');
  });

  it('a failed action sets the error for the item and the next success clears it', async () => {
    const { result } = renderHook(() => useWorkflowRuns(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    advanceRun.mockRejectedValueOnce(new Error('not awaiting'));
    let out: unknown;
    await act(async () => {
      out = await result.current.advance('R-1', true);
    });
    expect(out).toEqual({ ok: false });
    expect(advanceRun).toHaveBeenCalledWith('R-1', true);
    expect(result.current.actionState('7')).toEqual({ pending: false, error: 'not awaiting' });
    advanceRun.mockResolvedValueOnce({ ...run1, updatedAt: '2026-10-20T11:00:00Z', state: 'running' });
    await act(async () => {
      await result.current.advance('R-1');
    });
    expect(result.current.actionState('7').error).toBeNull();
  });

  it('stop applies the stopped run', async () => {
    const { result } = renderHook(() => useWorkflowRuns(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    stopRun.mockResolvedValue({ ...run1, state: 'stopped', updatedAt: '2026-10-20T11:00:00Z' });
    await act(async () => {
      await result.current.stop('R-1');
    });
    expect(stopRun).toHaveBeenCalledWith('R-1');
    expect(result.current.runs[0].state).toBe('stopped');
  });
});
