import { act, renderHook, waitFor } from '@testing-library/react';
import { useBacklog } from '../../src/state/use-backlog';
import * as api from '../../src/api/backlog-api';
import { ApiError } from '../../src/api/http';
import { FakeEventSource } from '../api/fake-event-source';
import type { BacklogItem } from '../../src/api/models';

jest.mock('../../src/api/backlog-api');

const getLanes = api.getLanes as jest.Mock;
const getItems = api.getItems as jest.Mock;
const moveItem = api.moveItem as jest.Mock;
const refreshBacklog = api.refreshBacklog as jest.Mock;

const item = (id: string, lane: string, updatedAt: string): BacklogItem => ({
  id,
  title: id,
  description: '',
  lane,
  assignees: [],
  url: '',
  fileLinks: [],
  updatedAt,
});
const lanes = {
  me: 'me',
  lanes: [
    { id: 'todo', title: 'To do' },
    { id: 'doing', title: 'Doing' },
  ],
};
const A = item('a', 'todo', '2026-10-20T12:00:00Z');
const B = item('b', 'todo', '2026-10-20T10:00:00Z');
const ids = (r: { current: { items: BacklogItem[] } }) => r.current.items.map((i) => i.id);

describe('useBacklog', () => {
  beforeEach(() => {
    FakeEventSource.install();
    [getLanes, getItems, moveItem, refreshBacklog].forEach((m) => m.mockReset());
    getLanes.mockResolvedValue(lanes);
    getItems.mockResolvedValue([A, B]);
  });

  it('is disabled without requests or stream when lanes are null', async () => {
    getLanes.mockResolvedValue(null);
    const { result } = renderHook(() => useBacklog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(getItems).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('loads lanes and items, merges stream updates in updatedAt order, removes', async () => {
    const { result } = renderHook(() => useBacklog());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.enabled).toBe(true);
    expect(result.current.me).toBe('me');
    expect(result.current.lanes).toEqual(lanes.lanes);
    expect(ids(result)).toEqual(['a', 'b']);

    act(() => FakeEventSource.last.emit('item', { ...B, lane: 'doing', updatedAt: '2026-10-20T13:00:00Z' }));
    expect(ids(result)).toEqual(['b', 'a']);
    expect(result.current.items[0].lane).toBe('doing');

    act(() => FakeEventSource.last.emit('item', item('c', 'todo', '2026-10-20T11:00:00Z')));
    expect(ids(result)).toEqual(['b', 'a', 'c']);

    act(() => FakeEventSource.last.emit('removed', { id: 'a' }));
    expect(ids(result)).toEqual(['b', 'c']);
  });

  it('reloads items on reconnect', async () => {
    const { result } = renderHook(() => useBacklog());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    getItems.mockClear();
    getItems.mockResolvedValue([B]);
    act(() => FakeEventSource.last.emit('open'));
    await waitFor(() => expect(ids(result)).toEqual(['b']));
    expect(getItems).toHaveBeenCalledTimes(1);
  });

  it('sets error from a server error event', async () => {
    const { result } = renderHook(() => useBacklog());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => FakeEventSource.last.emit('error', { message: 'source down' }));
    expect(result.current.error).toBe('source down');
  });

  it('moves optimistically, passing the current lane as from', async () => {
    let resolve!: (i: BacklogItem) => void;
    moveItem.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useBacklog());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    let p!: Promise<void>;
    act(() => {
      p = result.current.move('a', 'doing');
    });
    expect(result.current.items.find((i) => i.id === 'a')?.lane).toBe('doing');
    expect(moveItem).toHaveBeenCalledWith('a', 'todo', 'doing');
    await act(async () => {
      resolve({ ...A, lane: 'doing', updatedAt: '2026-10-20T14:00:00Z' });
      await p;
    });
    expect(result.current.items[0]).toMatchObject({ id: 'a', lane: 'doing', updatedAt: '2026-10-20T14:00:00Z' });
    expect(result.current.error).toBeNull();
  });

  it('snaps back and sets error when a move fails', async () => {
    moveItem.mockRejectedValue(new ApiError(502, 'gitlab down'));
    const { result } = renderHook(() => useBacklog());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(() => result.current.move('a', 'doing'));
    expect(result.current.items.find((i) => i.id === 'a')?.lane).toBe('todo');
    expect(result.current.error).toBe('gitlab down');
    expect(getItems).toHaveBeenCalledTimes(1);
  });

  it('reloads the items after a 409', async () => {
    moveItem.mockRejectedValue(new ApiError(409, 'moved elsewhere'));
    const { result } = renderHook(() => useBacklog());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    getItems.mockResolvedValue([{ ...A, lane: 'doing' }, B]);
    await act(() => result.current.move('a', 'doing'));
    await waitFor(() => expect(result.current.items.find((i) => i.id === 'a')?.lane).toBe('doing'));
    expect(result.current.error).toBe('moved elsewhere');
    expect(getItems).toHaveBeenCalledTimes(2);
  });

  it('refresh replaces the items', async () => {
    const { result } = renderHook(() => useBacklog());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    refreshBacklog.mockResolvedValue([B]);
    await act(() => result.current.refresh());
    expect(ids(result)).toEqual(['b']);
  });

  it('closes the stream on unmount', async () => {
    const { result, unmount } = renderHook(() => useBacklog());
    await waitFor(() => expect(result.current.enabled).toBe(true));
    const es = FakeEventSource.last;
    unmount();
    expect(es.closed).toBe(true);
  });
});
