import { useCallback, useEffect, useRef, useState } from 'react';

export const MAIN_SESSION = 'main';

export type View = 'tasks' | 'backlog' | 'workflows' | 'schedules' | 'architect';

export interface Route {
  repository: string | null;
  taskId: string | null;
  /** Selected session; null means the default (main). */
  session: string | null;
  view: View;
  /** Workflows view: a definition id, or `new`; absent shows the list. */
  workflow?: string;
  /** Workflows view, `new`: the definition to copy (`#/workflows/new?from=<id>`). */
  from?: string;
  /** Workflows view, `new`: the generation whose draft to open (`#/workflows/new?generation=<id>`). */
  generation?: string;
  /** Schedules view: a schedule id, or `new`; absent shows the list. */
  schedule?: string;
  /** Schedules view: the schedule's form (`#/schedules/<id>/edit`). */
  scheduleEdit?: boolean;
  /** Selected board item (`#/backlog?item=<id>`); absent when none. */
  item?: string;
  /** Architect view: the plan review shown (`#/architect/reviews/<branch>/<slug>`); the repository travels in `repository`. */
  review?: { branch: string; slug: string };
}

/**
 * Hash formats: `#/tasks/<id>` (no repository filter) and `#/repo/<name>/task/<id>`; either part may be
 * absent, and `?session=<name>` may follow either. `#/task/<id>` (older) is still read. `#/backlog` selects the board,
 * `#/backlog?item=<id>` with that item open.
 */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const q = raw.indexOf('?');
  const stripped = q < 0 ? raw : raw.slice(0, q);
  const route: Route = {
    repository: null,
    taskId: null,
    session: null,
    view: 'tasks',
  };
  if (stripped.replace(/\/+$/, '') === 'backlog') {
    const item = q >= 0 ? new URLSearchParams(raw.slice(q + 1)).get('item') : null;
    return item ? { ...route, view: 'backlog', item } : { ...route, view: 'backlog' };
  }
  const wf = stripped.split('/').filter(Boolean);
  if (wf[0] === 'architect') {
    const out: Route = { ...route, view: 'architect' };
    const repo = q >= 0 ? new URLSearchParams(raw.slice(q + 1)).get('repo') : null;
    if (repo) out.repository = repo;
    if (wf.length === 4 && wf[1] === 'reviews') {
      try {
        out.review = { branch: decodeURIComponent(wf[2]), slug: decodeURIComponent(wf[3]) };
      } catch {
        return { ...route, view: 'architect', ...(repo ? { repository: repo } : {}) };
      }
    }
    return out;
  }
  if (wf[0] === 'workflows' && wf.length <= 2) {
    const out: Route = { ...route, view: 'workflows' };
    if (wf[1]) {
      try {
        out.workflow = decodeURIComponent(wf[1]);
      } catch {
        return out;
      }
      const params = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '');
      const from = params.get('from');
      const generation = params.get('generation');
      if (out.workflow === 'new' && from) out.from = from;
      else if (out.workflow === 'new' && generation) out.generation = generation;
    }
    return out;
  }
  if (wf[0] === 'schedules' && wf.length <= 3) {
    const out: Route = { ...route, view: 'schedules' };
    if (wf.length === 3 && (wf[2] !== 'edit' || wf[1] === 'new')) return route;
    if (wf[1]) {
      try {
        out.schedule = decodeURIComponent(wf[1]);
      } catch {
        return out;
      }
      if (wf[2] === 'edit') out.scheduleEdit = true;
    }
    return out;
  }
  const parts = stripped.split('/').filter(Boolean);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    let value: string;
    try {
      value = decodeURIComponent(parts[i + 1]);
    } catch {
      continue; // malformed escape: treat as unset
    }
    if (parts[i] === 'repo') route.repository = value;
    if (parts[i] === 'task' || parts[i] === 'tasks') route.taskId = value;
  }
  if (q >= 0) {
    const session = new URLSearchParams(raw.slice(q + 1)).get('session');
    if (session && session !== MAIN_SESSION) route.session = session;
  }
  return route;
}

export function buildHash(route: Route): string {
  if (route.view === 'architect') {
    const base = route.review
      ? `#/architect/reviews/${encodeURIComponent(route.review.branch)}/${encodeURIComponent(route.review.slug)}`
      : '#/architect';
    return route.repository ? `${base}?repo=${encodeURIComponent(route.repository)}` : base;
  }
  if (route.view === 'backlog') return route.item ? `#/backlog?item=${encodeURIComponent(route.item)}` : '#/backlog';
  if (route.view === 'workflows') {
    if (!route.workflow) return '#/workflows';
    const base = `#/workflows/${encodeURIComponent(route.workflow)}`;
    if (route.workflow === 'new' && route.from) return `${base}?from=${encodeURIComponent(route.from)}`;
    if (route.workflow === 'new' && route.generation) return `${base}?generation=${encodeURIComponent(route.generation)}`;
    return base;
  }
  if (route.view === 'schedules') {
    if (!route.schedule) return '#/schedules';
    return `${scheduleHref(route.schedule)}${route.scheduleEdit && route.schedule !== 'new' ? '/edit' : ''}`;
  }
  let hash = '#';
  if (route.repository) {
    hash += `/repo/${encodeURIComponent(route.repository)}`;
    if (route.taskId) hash += `/task/${encodeURIComponent(route.taskId)}`;
  } else if (route.taskId) {
    hash += `/tasks/${encodeURIComponent(route.taskId)}`;
  }
  if (hash === '#') return '#/';
  if (route.taskId && route.session && route.session !== MAIN_SESSION)
    hash += `?session=${encodeURIComponent(route.session)}`;
  return hash;
}

export const scheduleHref = (id: string) => `#/schedules/${encodeURIComponent(id)}`;
export const taskHref = (id: string) => `#/tasks/${encodeURIComponent(id)}`;

/** The session to show: the requested one when the task has it, else main. */
export function resolveSession(name: string | null | undefined, sessions: { name: string }[] | undefined): string {
  return name && sessions?.some((s) => s.name === name) ? name : MAIN_SESSION;
}

/** Decides on a route change before it is applied: true holds it (the guard puts the old address back). */
type Blocker = (nextHash: string) => boolean;
let blocker: Blocker | null = null;

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => {
      if (blocker?.(window.location.hash)) return;
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.location.hash = buildHash(next);
  }, []);

  const selectTask = useCallback(
    (taskId: string | null) => navigate({ ...parseHash(window.location.hash), taskId, session: null }),
    [navigate],
  );
  /** The task screen of a task, from any view (no repository filter). */
  const openTask = useCallback(
    (taskId: string) => navigate({ repository: null, taskId, session: null, view: 'tasks' }),
    [navigate],
  );
  const selectSession = useCallback(
    (session: string | null) => navigate({ ...parseHash(window.location.hash), session }),
    [navigate],
  );
  const selectRepository = useCallback(
    // A plan review belongs to its repository: another repository drops it.
    (repository: string | null) => navigate({ ...parseHash(window.location.hash), repository, review: undefined }),
    [navigate],
  );
  const selectView = useCallback(
    (view: View) =>
      navigate({
        ...parseHash(window.location.hash),
        view,
        workflow: undefined,
        from: undefined,
        generation: undefined,
        schedule: undefined,
        scheduleEdit: undefined,
        review: undefined,
      }),
    [navigate],
  );
  /** A schedule's detail (or its form with `edit`), `new` for the form of a new one, null for the list. */
  const selectSchedule = useCallback(
    (schedule: string | null, edit = false) =>
      navigate({ ...parseHash(window.location.hash), view: 'schedules', schedule: schedule ?? undefined, scheduleEdit: edit || undefined }),
    [navigate],
  );
  const selectWorkflow = useCallback(
    (workflow: string | null, from?: string) =>
      navigate({
        ...parseHash(window.location.hash),
        view: 'workflows',
        workflow: workflow ?? undefined,
        from,
        generation: undefined,
      }),
    [navigate],
  );

  const selectItem = useCallback(
    (item: string | null) => navigate({ ...parseHash(window.location.hash), view: 'backlog', item: item ?? undefined }),
    [navigate],
  );

  const selectReview = useCallback(
    (review: { branch: string; slug: string } | null) =>
      navigate({ ...parseHash(window.location.hash), view: 'architect', review: review ?? undefined }),
    [navigate],
  );

  return {
    ...route,
    selectReview,
    review: route.review ?? null,
    item: route.item ?? null,
    /** Requested session name (main by default); resolve against the task's sessions with resolveSession. */
    session: route.session ?? MAIN_SESSION,
    selectTask,
    openTask,
    selectSession,
    selectRepository,
    selectView,
    selectItem,
    selectWorkflow,
    selectSchedule,
    schedule: route.schedule ?? null,
    scheduleEdit: route.scheduleEdit ?? false,
    workflow: route.workflow ?? null,
    from: route.from ?? null,
    generation: route.generation ?? null,
  };
}

export interface LeaveGuard {
  /** The address a held route change goes to; null when none is held. */
  pending: string | null;
  /** Drops the held change: the page stays. */
  stay: () => void;
  /** Lets the held change through. */
  proceed: () => void;
  /** Lets the next change through without asking (a leave that was already confirmed, or a save). */
  release: () => void;
  /** Holds changes again after a `release` that did not lead to a route change (a save that stays on the page). */
  rearm: () => void;
}

/**
 * While `active`, every route change away from the current address (a link, the sidebar, the browser's back) is held
 * and the address put back, until `proceed`; closing or reloading the page asks the browser's question.
 */
export function useLeaveGuard(active: boolean): LeaveGuard {
  const [pending, setPending] = useState<string | null>(null);
  const mine = useRef<Blocker | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!active) return;
    const here = window.location.hash;
    const block: Blocker = (next) => {
      if (next === here) return false;
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${here}`);
      setPending(next);
      return true;
    };
    blocker = block;
    mine.current = block;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      if (blocker === block) blocker = null;
      mine.current = null;
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [active, epoch]);

  const release = useCallback(() => {
    if (mine.current && blocker === mine.current) blocker = null;
  }, []);
  const rearm = useCallback(() => setEpoch((n) => n + 1), []);
  const stay = useCallback(() => setPending(null), []);
  const proceed = useCallback(() => {
    release();
    setPending(null);
    if (pending !== null) window.location.hash = pending;
  }, [pending, release]);

  return { pending, stay, proceed, release, rearm };
}
