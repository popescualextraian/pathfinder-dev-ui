import { useCallback, useEffect, useState } from 'react';

export const MAIN_SESSION = 'main';

export interface Route {
  repository: string | null;
  taskId: string | null;
  /** Selected session; null means the default (main). */
  session: string | null;
  view: 'tasks' | 'backlog' | 'workflows';
  /** Workflows view: a definition id, or `new`; absent shows the list. */
  workflow?: string;
  /** Workflows view, `new`: the definition to copy (`#/workflows/new?from=<id>`). */
  from?: string;
  /** Selected board item (`#/backlog?item=<id>`); absent when none. */
  item?: string;
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
  if (wf[0] === 'workflows' && wf.length <= 2) {
    const out: Route = { ...route, view: 'workflows' };
    if (wf[1]) {
      try {
        out.workflow = decodeURIComponent(wf[1]);
      } catch {
        return out;
      }
      const from = q >= 0 ? new URLSearchParams(raw.slice(q + 1)).get('from') : null;
      if (out.workflow === 'new' && from) out.from = from;
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
  if (route.view === 'backlog') return route.item ? `#/backlog?item=${encodeURIComponent(route.item)}` : '#/backlog';
  if (route.view === 'workflows') {
    if (!route.workflow) return '#/workflows';
    const base = `#/workflows/${encodeURIComponent(route.workflow)}`;
    return route.workflow === 'new' && route.from ? `${base}?from=${encodeURIComponent(route.from)}` : base;
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

/** The session to show: the requested one when the task has it, else main. */
export function resolveSession(name: string | null | undefined, sessions: { name: string }[] | undefined): string {
  return name && sessions?.some((s) => s.name === name) ? name : MAIN_SESSION;
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
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
  const selectSession = useCallback(
    (session: string | null) => navigate({ ...parseHash(window.location.hash), session }),
    [navigate],
  );
  const selectRepository = useCallback(
    (repository: string | null) => navigate({ ...parseHash(window.location.hash), repository }),
    [navigate],
  );
  const selectView = useCallback(
    (view: 'tasks' | 'backlog' | 'workflows') =>
      navigate({ ...parseHash(window.location.hash), view, workflow: undefined, from: undefined }),
    [navigate],
  );
  const selectWorkflow = useCallback(
    (workflow: string | null, from?: string) =>
      navigate({ ...parseHash(window.location.hash), view: 'workflows', workflow: workflow ?? undefined, from }),
    [navigate],
  );

  const selectItem = useCallback(
    (item: string | null) => navigate({ ...parseHash(window.location.hash), view: 'backlog', item: item ?? undefined }),
    [navigate],
  );

  return {
    ...route,
    item: route.item ?? null,
    /** Requested session name (main by default); resolve against the task's sessions with resolveSession. */
    session: route.session ?? MAIN_SESSION,
    selectTask,
    selectSession,
    selectRepository,
    selectView,
    selectItem,
    selectWorkflow,
    workflow: route.workflow ?? null,
    from: route.from ?? null,
  };
}
