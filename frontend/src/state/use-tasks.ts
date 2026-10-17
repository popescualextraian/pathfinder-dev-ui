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
  // Changes seen on the stream while a load runs: the (older) GET must not undo them.
  const touched = useRef(new Map<string, Task | null>());

  const load = useCallback(() => {
    const seq = ++latestLoad.current;
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
        if (seq === latestLoad.current) setLoading(false);
      });
  }, []);

  const applyTask = useCallback((task: Task) => {
    touched.current.set(task.id, task);
    setAllTasks((list) => upsertTask(list, task));
  }, []);

  const removeTask = useCallback((id: string) => {
    touched.current.set(id, null);
    setAllTasks((list) => list.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const stop = openTaskStatusStream({
      // Contract order: stream connected, then load. Every (re)connect reloads; a newer load
      // supersedes an older one, and stream changes seen meanwhile are kept (see `touched`).
      onOpen: () => void load(),
      onTask: applyTask,
      onRemoved: removeTask,
    });
    void load();
    return stop;
  }, [load, applyTask, removeTask]);

  const tasks = useMemo(
    () => (repository ? allTasks.filter((t) => t.repository === repository) : allTasks),
    [allTasks, repository],
  );

  return { tasks, allTasks, loading, error, applyTask, removeTask };
}
