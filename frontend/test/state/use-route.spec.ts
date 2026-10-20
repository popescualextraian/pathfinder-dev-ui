import { act, renderHook } from '@testing-library/react';
import { buildHash, parseHash, resolveSession, useRoute } from '../../src/state/use-route';

describe('route hash', () => {
  it('parses and builds', () => {
    expect(parseHash('#/repo/my%20repo/task/T-1')).toEqual({
      repository: 'my repo',
      taskId: 'T-1',
      session: null,
      view: 'tasks',
    });
    expect(parseHash('#/repo/%E0%A4%A/task/T-1')).toEqual({
      repository: null,
      taskId: 'T-1',
      session: null,
      view: 'tasks',
    });
    expect(parseHash('#/task/%')).toEqual({
      repository: null,
      taskId: null,
      session: null,
      view: 'tasks',
    });
    expect(parseHash('')).toEqual({
      repository: null,
      taskId: null,
      session: null,
      view: 'tasks',
    });
    expect(
      buildHash({
        repository: 'a',
        taskId: 'T-1',
        session: null,
        view: 'tasks',
      }),
    ).toBe('#/repo/a/task/T-1');
    expect(
      buildHash({
        repository: null,
        taskId: null,
        session: null,
        view: 'tasks',
      }),
    ).toBe('#/');
  });

  it('selects the board with #/backlog and round-trips', () => {
    expect(parseHash('#/backlog')).toEqual({
      repository: null,
      taskId: null,
      session: null,
      view: 'backlog',
    });
    expect(buildHash(parseHash('#/backlog'))).toBe('#/backlog');
    for (const h of [
      '#/repo/a/task/T-1',
      '#/repo/a',
      '#/tasks/T-1',
      '#/repo/a/task/T-1?session=second',
      '#/tasks/T-1?session=a%20b',
      '#/',
    ]) {
      expect(buildHash(parseHash(h))).toBe(h);
    }
  });
});

describe('route sessions', () => {
  it('reads both forms with an optional session', () => {
    expect(parseHash('#/tasks/T-1?session=second')).toEqual({
      repository: null,
      taskId: 'T-1',
      session: 'second',
      view: 'tasks',
    });
    expect(parseHash('#/repo/a/task/T-1?session=second').repository).toBe('a');
    expect(parseHash('#/task/T-1').taskId).toBe('T-1');
    expect(buildHash(parseHash('#/task/T-1'))).toBe('#/tasks/T-1');
    expect(parseHash('#/tasks/T-1?session=main').session).toBeNull();
    expect(
      buildHash({
        repository: null,
        taskId: null,
        session: 'x',
        view: 'tasks',
      }),
    ).toBe('#/');
  });

  it('resolves unknown session names to main', () => {
    const sessions = [{ name: 'main' }, { name: 'second' }];
    expect(resolveSession('second', sessions)).toBe('second');
    expect(resolveSession('nope', sessions)).toBe('main');
    expect(resolveSession(null, sessions)).toBe('main');
    expect(resolveSession('second', undefined)).toBe('main');
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

  it('selects a session, defaulting to main, and resets it with the task', () => {
    window.location.hash = '#/tasks/T-1?session=second';
    const { result } = renderHook(() => useRoute());
    expect(result.current.session).toBe('second');
    act(() => result.current.selectSession('third'));
    expect(window.location.hash).toBe('#/tasks/T-1?session=third');
    act(() => result.current.selectSession(null));
    expect(window.location.hash).toBe('#/tasks/T-1');
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current.session).toBe('main');
    act(() => result.current.selectSession('x'));
    act(() => result.current.selectTask('T-2'));
    expect(window.location.hash).toBe('#/tasks/T-2');
  });
});

describe('route board item', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('reads and builds #/backlog?item=<id>', () => {
    expect(parseHash('#/backlog?item=7')).toEqual({
      repository: null,
      taskId: null,
      session: null,
      view: 'backlog',
      item: '7',
    });
    expect(parseHash('#/backlog').item).toBeUndefined();
    expect(buildHash(parseHash('#/backlog?item=a%20b'))).toBe('#/backlog?item=a%20b');
    expect(parseHash('#/tasks/T-1?item=7').item).toBeUndefined();
  });

  it('selects and clears the board item', () => {
    window.location.hash = '#/backlog';
    const { result } = renderHook(() => useRoute());
    expect(result.current.item).toBeNull();
    act(() => result.current.selectItem('7'));
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(window.location.hash).toBe('#/backlog?item=7');
    expect(result.current.item).toBe('7');
    act(() => result.current.selectItem(null));
    expect(window.location.hash).toBe('#/backlog');
  });
});

describe('workflows route', () => {
  it('parses and builds the list, an id, new and duplicate', () => {
    expect(parseHash('#/workflows')).toMatchObject({ view: 'workflows' });
    expect(parseHash('#/workflows').workflow).toBeUndefined();
    expect(parseHash('#/workflows/two')).toMatchObject({ view: 'workflows', workflow: 'two' });
    expect(parseHash('#/workflows/new?from=two')).toMatchObject({ view: 'workflows', workflow: 'new', from: 'two' });
    expect(buildHash({ ...parseHash('#/workflows'), workflow: undefined })).toBe('#/workflows');
    expect(buildHash(parseHash('#/workflows/two'))).toBe('#/workflows/two');
    expect(buildHash(parseHash('#/workflows/new?from=a%20b'))).toBe('#/workflows/new?from=a%20b');
  });
});
