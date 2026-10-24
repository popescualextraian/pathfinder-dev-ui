import { act, renderHook } from '@testing-library/react';
import { buildHash, parseHash, resolveSession, scheduleHref, taskHref, useLeaveGuard, useRoute } from '../../src/state/use-route';

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

  it('openTask goes to the task screen of a task from any view', () => {
    window.location.hash = '#/backlog?item=7';
    const { result } = renderHook(() => useRoute());
    act(() => result.current.openTask('T-9'));
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(window.location.hash).toBe('#/tasks/T-9');
    expect(result.current.view).toBe('tasks');
    expect(result.current.taskId).toBe('T-9');
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

  it('parses and builds a new workflow from a generation', () => {
    expect(parseHash('#/workflows/new?generation=G-1')).toMatchObject({ view: 'workflows', workflow: 'new', generation: 'G-1' });
    expect(parseHash('#/workflows/new?generation=G-1').from).toBeUndefined();
    expect(parseHash('#/workflows/two?generation=G-1').generation).toBeUndefined();
    expect(buildHash(parseHash('#/workflows/new?generation=G%201'))).toBe('#/workflows/new?generation=G%201');
    expect(buildHash({ ...parseHash('#/workflows'), workflow: 'new', generation: 'G-2' })).toBe('#/workflows/new?generation=G-2');
  });

  it('useRoute exposes the generation (null when absent) and selectView drops it', () => {
    window.location.hash = '#/workflows/new?generation=G-1';
    const route = renderHook(() => useRoute());
    expect(route.result.current.generation).toBe('G-1');
    act(() => route.result.current.selectView('workflows'));
    expect(window.location.hash).toBe('#/workflows');
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(route.result.current.generation).toBeNull();
  });
});

describe('useLeaveGuard', () => {
  const fire = () =>
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

  beforeEach(() => {
    window.location.hash = '#/workflows/wf';
  });

  it('while active, holds a route change (link, sidebar, back) until confirmed and restores the address', () => {
    const route = renderHook(() => useRoute());
    const guard = renderHook(({ active }) => useLeaveGuard(active), { initialProps: { active: true } });
    act(() => route.result.current.selectView('backlog'));
    fire();
    expect(guard.result.current.pending).toBe('#/backlog');
    expect(route.result.current.view).toBe('workflows');
    expect(window.location.hash).toBe('#/workflows/wf');

    act(() => guard.result.current.stay());
    expect(guard.result.current.pending).toBeNull();
    expect(window.location.hash).toBe('#/workflows/wf');

    window.location.hash = '#/tasks/T-1';
    fire();
    expect(guard.result.current.pending).toBe('#/tasks/T-1');
    act(() => guard.result.current.proceed());
    fire();
    expect(window.location.hash).toBe('#/tasks/T-1');
    expect(route.result.current.view).toBe('tasks');
    expect(guard.result.current.pending).toBeNull();
  });

  it('lets everything through when inactive or released', () => {
    const route = renderHook(() => useRoute());
    const guard = renderHook(({ active }) => useLeaveGuard(active), { initialProps: { active: false } });
    act(() => route.result.current.selectView('backlog'));
    fire();
    expect(route.result.current.view).toBe('backlog');

    window.location.hash = '#/workflows/wf';
    fire();
    guard.rerender({ active: true });
    act(() => guard.result.current.release());
    act(() => route.result.current.selectView('tasks'));
    fire();
    expect(route.result.current.view).toBe('tasks');
    expect(guard.result.current.pending).toBeNull();
  });

  it('rearm after a release holds changes again while still active', () => {
    const route = renderHook(() => useRoute());
    const guard = renderHook(({ active }) => useLeaveGuard(active), { initialProps: { active: true } });
    act(() => guard.result.current.release());
    act(() => guard.result.current.rearm());
    act(() => route.result.current.selectView('backlog'));
    fire();
    expect(guard.result.current.pending).toBe('#/backlog');
    expect(route.result.current.view).toBe('workflows');
  });

  it('asks the browser before unloading the page while active', () => {
    const guard = renderHook(({ active }) => useLeaveGuard(active), { initialProps: { active: true } });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    guard.rerender({ active: false });
    const later = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });
});

describe('schedules route', () => {
  it('parses and builds list, new, detail and edit', () => {
    expect(parseHash('#/schedules')).toMatchObject({ view: 'schedules' });
    expect(parseHash('#/schedules').schedule).toBeUndefined();
    expect(parseHash('#/schedules/new')).toMatchObject({ view: 'schedules', schedule: 'new' });
    expect(parseHash('#/schedules/nightly')).toMatchObject({ view: 'schedules', schedule: 'nightly' });
    expect(parseHash('#/schedules/nightly').scheduleEdit).toBeUndefined();
    expect(parseHash('#/schedules/nightly/edit')).toMatchObject({ view: 'schedules', schedule: 'nightly', scheduleEdit: true });
    for (const h of ['#/schedules', '#/schedules/new', '#/schedules/nightly', '#/schedules/nightly/edit']) expect(buildHash(parseHash(h))).toBe(h);
    expect(parseHash('#/schedules/a/b/c').view).toBe('tasks');
  });

  it('selectSchedule and selectView move between the pages', () => {
    window.location.hash = '#/schedules/nightly/edit';
    const route = renderHook(() => useRoute());
    expect(route.result.current).toMatchObject({ view: 'schedules', schedule: 'nightly', scheduleEdit: true });
    act(() => route.result.current.selectSchedule('nightly'));
    expect(window.location.hash).toBe('#/schedules/nightly');
    act(() => route.result.current.selectSchedule('nightly', true));
    expect(window.location.hash).toBe('#/schedules/nightly/edit');
    act(() => route.result.current.selectView('schedules'));
    expect(window.location.hash).toBe('#/schedules');
    act(() => route.result.current.selectView('tasks'));
    expect(window.location.hash).toBe('#/');
  });
});

describe('architect route', () => {
  it('round trips', () => {
    expect(parseHash('#/architect')).toMatchObject({ view: 'architect', repository: null });
    expect(parseHash('#/architect').review).toBeUndefined();
    expect(parseHash('#/architect?repo=shop')).toMatchObject({ view: 'architect', repository: 'shop' });
    const h = '#/architect/reviews/feature%2Fgift-cards/slug?repo=shop';
    expect(parseHash(h)).toMatchObject({
      view: 'architect', repository: 'shop', review: { branch: 'feature/gift-cards', slug: 'slug' },
    });
    for (const x of ['#/architect', '#/architect?repo=shop', h, '#/architect/reviews/main/s']) {
      expect(buildHash(parseHash(x))).toBe(x);
    }
  });

  it('falls back to the plain view on malformed escapes', () => {
    const r = parseHash('#/architect/reviews/%E0%A4%A/slug?repo=shop');
    expect(r).toMatchObject({ view: 'architect', repository: 'shop' });
    expect(r.review).toBeUndefined();
  });

  it('selectReview keeps the repository, selectView clears the review', () => {
    window.location.hash = '#/architect?repo=shop';
    const route = renderHook(() => useRoute());
    act(() => route.result.current.selectReview({ branch: 'feature/x', slug: 's' }));
    expect(window.location.hash).toBe('#/architect/reviews/feature%2Fx/s?repo=shop');
    act(() => route.result.current.selectReview(null));
    expect(window.location.hash).toBe('#/architect?repo=shop');
    act(() => route.result.current.selectReview({ branch: 'b', slug: 's' }));
    act(() => route.result.current.selectView('architect'));
    expect(window.location.hash).toBe('#/architect?repo=shop');
  });
});

describe('scheduleHref / taskHref', () => {
  it('builds links', () => {
    expect(scheduleHref('a b')).toBe('#/schedules/a%20b');
    expect(taskHref('T-1')).toBe('#/tasks/T-1');
  });
});
