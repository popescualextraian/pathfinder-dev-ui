import { act, renderHook, waitFor } from '@testing-library/react';
import { useTasks } from '../../src/state/use-tasks';
import { useRepositories } from '../../src/state/use-repositories';
import * as tasksApi from '../../src/api/tasks-api';
import * as reposApi from '../../src/api/repositories-api';
import { FakeEventSource } from '../api/fake-event-source';
import { makeTask } from '../fixtures/tasks';

jest.mock('../../src/api/tasks-api');
jest.mock('../../src/api/repositories-api');

const listTasks = tasksApi.listTasks as jest.Mock;

describe('useTasks', () => {
  beforeEach(() => {
    FakeEventSource.install();
    listTasks.mockReset();
  });

  it('loads, upserts newest first, removes, and reloads on reconnect', async () => {
    const a = makeTask({ id: 'T-a', createdAt: '2026-10-17T10:00:00Z' });
    listTasks.mockResolvedValue([a]);
    const { result } = renderHook(() => useTasks(null));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks.map((t) => t.id)).toEqual(['T-a']);

    const b = makeTask({ id: 'T-b', createdAt: '2026-10-17T11:00:00Z' });
    act(() => FakeEventSource.last.emit('task', b));
    expect(result.current.tasks.map((t) => t.id)).toEqual(['T-b', 'T-a']);

    act(() => FakeEventSource.last.emit('task', { ...a, state: 'waiting', section: 'needs-you' }));
    expect(result.current.tasks.map((t) => t.id)).toEqual(['T-b', 'T-a']);
    expect(result.current.tasks[1].state).toBe('waiting');

    act(() => FakeEventSource.last.emit('removed', { id: 'T-b' }));
    expect(result.current.tasks.map((t) => t.id)).toEqual(['T-a']);

    listTasks.mockClear();
    listTasks.mockResolvedValue([b]);
    act(() => FakeEventSource.last.emit('open'));
    await waitFor(() => expect(result.current.tasks.map((t) => t.id)).toEqual(['T-b']));
    expect(listTasks).toHaveBeenCalledTimes(1);
  });

  it('filters by repository but keeps allTasks', async () => {
    listTasks.mockResolvedValue([
      makeTask({ id: 'T-a', repository: 'x' }),
      makeTask({ id: 'T-b', repository: 'y' }),
    ]);
    const { result } = renderHook(() => useTasks('y'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks.map((t) => t.id)).toEqual(['T-b']);
    expect(result.current.allTasks).toHaveLength(2);
  });

  it('exposes load errors', async () => {
    listTasks.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useTasks(null));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.loading).toBe(false);
  });

  it('closes the stream on unmount', async () => {
    listTasks.mockResolvedValue([]);
    const { unmount } = renderHook(() => useTasks(null));
    const es = FakeEventSource.last;
    unmount();
    expect(es.closed).toBe(true);
  });
});

describe('useRepositories', () => {
  it('loads repositories', async () => {
    (reposApi.listRepositories as jest.Mock).mockResolvedValue([{ name: 'r', url: 'u', default: true }]);
    const { result } = renderHook(() => useRepositories());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.repositories[0].name).toBe('r');
  });
});
