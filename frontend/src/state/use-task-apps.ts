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
 * unavailable: the local-launcher message is kept as a notice, a task that is not running is `suspended`
 * (the view offers Start, which wakes it), any other 409 (task stopped) just shows no apps. Start and restart
 * can take minutes, so the action stays busy until the API answers. An action's error stays through
 * refreshes until the next action; a list error goes with the next good list.
 */
export function useTaskApps(taskId: string, taskState: TaskState) {
  const [apps, setApps] = useState<TaskApp[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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
      setSuspended(false);
      setListError(null);
    } catch (e) {
      if (!alive.current) return;
      setApps([]);
      if (e instanceof ApiError && e.status === 409) {
        setListError(null);
        setNotice(/Docker launcher/.test(e.message) ? e.message : null);
        setSuspended(/ is not running\b/.test(e.message));
      } else {
        setNotice(null);
        setSuspended(false);
        setListError(message(e));
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
      setActionError(null);
      try {
        const call = action === 'start' ? api.startApp : action === 'stop' ? api.stopApp : api.restartApp;
        const updated = await call(taskId, name);
        if (alive.current && updated && typeof updated === 'object') {
          // a start from the suspended view: the app list begins with the app it woke
          setApps((list) => (list.some((a) => a.name === name) ? list.map((a) => (a.name === name ? updated : a)) : [...list, updated]));
          setSuspended(false);
        }
      } catch (e) {
        if (alive.current) setActionError(message(e));
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
      setActionError(null);
      try {
        const { lines } = await api.appLogs(taskId, name, LOG_LINES);
        if (alive.current) setLogs((l) => ({ ...l, [name]: lines }));
      } catch (e) {
        if (alive.current) setActionError(message(e));
      }
    },
    [taskId, logs],
  );

  return { apps, notice, suspended, error: actionError ?? listError, busy, logs, act, toggleLogs };
}
