import { act, renderHook } from '@testing-library/react';
import { buildHash, parseHash, useRoute } from '../../src/state/use-route';

describe('route hash', () => {
  it('parses and builds', () => {
    expect(parseHash('#/repo/my%20repo/task/T-1')).toEqual({ repository: 'my repo', taskId: 'T-1' });
    expect(parseHash('')).toEqual({ repository: null, taskId: null });
    expect(buildHash({ repository: 'a', taskId: 'T-1' })).toBe('#/repo/a/task/T-1');
    expect(buildHash({ repository: null, taskId: null })).toBe('#/');
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
});
