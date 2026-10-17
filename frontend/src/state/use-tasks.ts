import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Task } from '../api/models';
import { listTasks } from '../api/tasks-api';
import { openTaskStatusStream } from '../api/task-status-stream';

const newestFirst = (a: Task, b: Task) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

export function upsertTask(list: Task[], task: Task): Task[] {
  return [...list.filter((t) => t.id !== task.id), task].sort(newestFirst);
}

/** Loads the task list, keeps it current from the status stream and reloads on every (re)connect. */
export function useTasks(repository: string | null) {
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return listTasks()
      .then((list) => {
        setAllTasks([...list].sort(newestFirst));
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // onOpen fires on every connect, including the first, so it does the loading.
    return openTaskStatusStream({
      onOpen: () => void load(),
      onTask: (task) => setAllTasks((list) => upsertTask(list, task)),
      onRemoved: (id) => setAllTasks((list) => list.filter((t) => t.id !== id)),
    });
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const tasks = useMemo(
    () => (repository ? allTasks.filter((t) => t.repository === repository) : allTasks),
    [allTasks, repository],
  );

  return { tasks, allTasks, loading, error };
}
