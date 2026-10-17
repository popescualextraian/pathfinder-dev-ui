import { useEffect, useRef, useState } from 'react';
import type { Task } from '../api/models';
import { getTask } from '../api/tasks-api';

/**
 * Loads one task (GET /api/tasks/:id) and follows updates. It does not open a stream of its own:
 * pass the live list from useTasks (which owns the status stream); the newer copy by updatedAt wins.
 * A task that was in the live list and then leaves it was removed: it is shown as not found.
 */
export function useTask(id: string | null, live: Task[] = []) {
  const [fetched, setFetched] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const seenLive = useRef<string | null>(null);

  useEffect(() => {
    setFetched(null);
    setError(null);
    setGone(null);
    seenLive.current = null;
    if (!id) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    getTask(id)
      .then((t) => active && setFetched(t))
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  const listed = id ? live.find((t) => t.id === id) : undefined;
  const wasRemoved = !!id && !listed && seenLive.current === id;
  useEffect(() => {
    if (!id) return;
    if (listed) seenLive.current = id;
    else if (seenLive.current === id) setGone(id);
  }, [id, listed]);

  if (id && (gone === id || wasRemoved)) return { task: null, loading: false, error: 'Task not found' };
  const own = fetched && fetched.id === id ? fetched : null;
  const task = listed && (!own || listed.updatedAt >= own.updatedAt) ? listed : own;
  return { task, loading: loading && !task, error: task ? null : error };
}
