import { act, renderHook } from '@testing-library/react';
import { buildHash, parseHash, useRoute } from '../../src/state/use-route';

describe('route hash', () => {
  it('parses and builds', () => {
    expect(parseHash('#/repo/my%20repo/task/T-1')).toEqual({
      repository: 'my repo',
      taskId: 'T-1',
      view: 'tasks',
    });
    expect(parseHash('#/repo/%E0%A4%A/task/T-1')).toEqual({
      repository: null,
      taskId: 'T-1',
      view: 'tasks',
    });
    expect(parseHash('#/task/%')).toEqual({ repository: null, taskId: null, view: 'tasks' });
    expect(parseHash('')).toEqual({ repository: null, taskId: null, view: 'tasks' });
    expect(buildHash({ repository: 'a', taskId: 'T-1', view: 'tasks' })).toBe('#/repo/a/task/T-1');
    expect(buildHash({ repository: null, taskId: null, view: 'tasks' })).toBe('#/');
  });

  it('selects the board with #/backlog and round-trips', () => {
    expect(parseHash('#/backlog')).toEqual({ repository: null, taskId: null, view: 'backlog' });
    expect(buildHash(parseHash('#/backlog'))).toBe('#/backlog');
    for (const h of ['#/repo/a/task/T-1', '#/repo/a', '#/task/T-1', '#/']) {
      expect(buildHash(parseHash(h))).toBe(h);
    }
  });
});

describe('useRoute', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('reads the hash, reacts to hashchange and sets parts independently', () => {
    window.location.hash = '#/task/T-9';
    const { result } = renderHook(() => useRoute());
    expect(result.current.taskId).toBe('T-9');

    act(() => result.current.selectRepository('r1'));
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(window.location.hash).toBe('#/repo/r1/task/T-9');
    expect(result.current.repository).toBe('r1');

    act(() => result.current.selectTask(null));
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current.taskId).toBeNull();
    expect(result.current.repository).toBe('r1');
  });

  it('switches between the task and board views', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current.view).toBe('tasks');
    act(() => result.current.selectView('backlog'));
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(window.location.hash).toBe('#/backlog');
    expect(result.current.view).toBe('backlog');
    act(() => result.current.selectView('tasks'));
    expect(window.location.hash).toBe('#/');
  });
});
