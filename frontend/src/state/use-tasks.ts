import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '../api/models';
import { listTasks } from '../api/tasks-api';
import { openTaskStatusStream } from '../api/task-status-stream';

const newestFirst = (a: Task, b: Task) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

/** Inserts or replaces a task unless the list already holds a newer copy (by updatedAt). */
export function upsertTask(list: Task[], task: Task): Task[] {
  const current = list.find((t) => t.id === task.id);
  if (current && current.updatedAt > task.updatedAt) return list;
  return [...list.filter((t) => t.id !== task.id), task].sort(newestFirst);
}

/** Loads the task list, keeps it current from the status stream and reloads on every (re)connect. */
export function useTasks(repository: string | null) {
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestLoad = useRef(0);
  const inFlight = useRef(0);
  // Changes seen on the stream while a load runs: the (older) GET must not undo them.
  const touched = useRef(new Map<string, Task | null>());

  const load = useCallback(() => {
    const seq = ++latestLoad.current;
    inFlight.current++;
    touched.current = new Map();
    return listTasks()
      .then((list) => {
        if (seq !== latestLoad.current) return;
        const seen = touched.current;
        setAllTasks((current) => {
          let merged = list.map((t) => {
            const mine = current.find((c) => c.id === t.id);
            return mine && mine.updatedAt > t.updatedAt ? mine : t;
          });
          for (const [id, task] of seen) {
            merged = merged.filter((t) => t.id !== id);
            if (task) merged.push(task);
          }
          return merged.sort(newestFirst);
        });
        setError(null);
      })
      .catch((e: unknown) => {
        if (seq === latestLoad.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        inFlight.current--;
        if (seq === latestLoad.current) setLoading(false);
      });
  }, []);

  const applyTask = useCallback((task: Task) => {
    touched.current.set(task.id, task);
    setAllTasks((list) => upsertTask(list, task));
  }, []);

  useEffect(() => {
    let opened = false;
    const stop = openTaskStatusStream({
      // Reload on every (re)connect, but the first open does not repeat the initial load in flight.
      onOpen: () => {
        const first = !opened;
        opened = true;
        if (first && inFlight.current > 0) return;
        void load();
      },
      onTask: applyTask,
      onRemoved: (id) => {
        touched.current.set(id, null);
        setAllTasks((list) => list.filter((t) => t.id !== id));
      },
    });
    void load();
    return stop;
  }, [load, applyTask]);

  const tasks = useMemo(
    () => (repository ? allTasks.filter((t) => t.repository === repository) : allTasks),
    [allTasks, repository],
  );

  return { tasks, allTasks, loading, error, applyTask };
}
