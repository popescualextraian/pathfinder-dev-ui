import { useEffect, useState } from 'react';
import type { Task } from '../api/models';
import { getTask } from '../api/tasks-api';

/**
 * Loads one task (GET /api/tasks/:id) and follows updates. It does not open a stream of its own:
 * pass the live list from useTasks (which owns the status stream); the newer copy by updatedAt wins.
 */
export function useTask(id: string | null, live: Task[] = []) {
  const [fetched, setFetched] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFetched(null);
    setError(null);
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
  const task = listed && (!fetched || listed.updatedAt >= fetched.updatedAt) ? listed : (fetched ?? null);
  return { task, loading: loading && !task, error: task ? null : error };
}
