import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskApp, TaskState } from '../api/models';
import { ApiError } from '../api/http';
import { openTaskEventsStream } from '../api/task-events-stream';
import * as api from '../api/tasks-api';

export type AppAction = 'start' | 'stop' | 'restart';

const REFRESH_DELAY_MS = 150; // collapses the burst of a replayed stream into one refetch
const LOG_LINES = 200;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Apps of one task: listed on mount and when the task state changes, refetched on an `app` event of the
 * task event stream (opened only while the task has apps). A 409 on the list means the apps are
 * unavailable: the local-launcher message is kept as a notice, any other 409 (task not running or stopped)
 * just shows no apps. Start and restart can take minutes, so the action stays busy until the API answers.
 */
export function useTaskApps(taskId: string, taskState: TaskState) {
  const [apps, setApps] = useState<TaskApp[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, AppAction | undefined>>({});
  const [logs, setLogs] = useState<Record<string, string[] | undefined>>({});
  const alive = useRef(true);
  const hasApps = apps.length > 0;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await Promise.resolve(api.listApps(taskId));
      if (!alive.current) return;
      setApps(Array.isArray(list) ? list : []);
      setNotice(null);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      setApps([]);
      if (e instanceof ApiError && e.status === 409) {
        setError(null);
        setNotice(/Docker launcher/.test(e.message) ? e.message : null);
      } else {
        setNotice(null);
        setError(message(e));
      }
    }
  }, [taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh, taskState]);

  useEffect(() => {
    if (!hasApps) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = openTaskEventsStream(taskId, (event) => {
      if (event.type !== 'app') return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), REFRESH_DELAY_MS);
    });
    return () => {
      close();
      clearTimeout(timer);
    };
  }, [taskId, hasApps, refresh]);

  const act = useCallback(
    async (name: string, action: AppAction) => {
      setBusy((b) => ({ ...b, [name]: action }));
      setError(null);
      try {
        const call = action === 'start' ? api.startApp : action === 'stop' ? api.stopApp : api.restartApp;
        const updated = await call(taskId, name);
        if (alive.current && updated && typeof updated === 'object')
          setApps((list) => list.map((a) => (a.name === name ? updated : a)));
      } catch (e) {
        if (alive.current) setError(message(e));
      } finally {
        if (alive.current) setBusy((b) => ({ ...b, [name]: undefined }));
      }
    },
    [taskId],
  );

  /** Shows the logs of an app, or hides them when already shown. */
  const toggleLogs = useCallback(
    async (name: string) => {
      if (logs[name]) {
        setLogs((l) => ({ ...l, [name]: undefined }));
        return;
      }
      setError(null);
      try {
        const { lines } = await api.appLogs(taskId, name, LOG_LINES);
        if (alive.current) setLogs((l) => ({ ...l, [name]: lines }));
      } catch (e) {
        if (alive.current) setError(message(e));
      }
    },
    [taskId, logs],
  );

  return { apps, notice, error, busy, logs, act, toggleLogs };
}
