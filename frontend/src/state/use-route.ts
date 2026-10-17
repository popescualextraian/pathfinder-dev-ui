import { useCallback, useEffect, useState } from 'react';

export interface Route {
  repository: string | null;
  taskId: string | null;
}

/** Hash format: #/repo/<name>/task/<id>; either part may be absent. */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const route: Route = { repository: null, taskId: null };
  for (let i = 0; i + 1 < parts.length; i += 2) {
    let value: string;
    try {
      value = decodeURIComponent(parts[i + 1]);
    } catch {
      continue; // malformed escape: treat as unset
    }
    if (parts[i] === 'repo') route.repository = value;
    if (parts[i] === 'task') route.taskId = value;
  }
  return route;
}

export function buildHash(route: Route): string {
  let hash = '#';
  if (route.repository) hash += `/repo/${encodeURIComponent(route.repository)}`;
  if (route.taskId) hash += `/task/${encodeURIComponent(route.taskId)}`;
  return hash === '#' ? '#/' : hash;
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
    (taskId: string | null) => navigate({ ...parseHash(window.location.hash), taskId }),
    [navigate],
  );
  const selectRepository = useCallback(
    (repository: string | null) => navigate({ ...parseHash(window.location.hash), repository }),
    [navigate],
  );

  return { ...route, selectTask, selectRepository };
}
