import { useCallback, useState } from 'react';
import type { AddSessionRequest, StartTaskRequest, Task } from '../api/models';
import * as api from '../api/tasks-api';

export interface Action<A extends unknown[], R> {
  run: (...args: A) => Promise<{ ok: boolean; value?: R }>;
  pending: boolean;
  error: string | null;
}

/** Wraps an API call with pending and error state; run resolves {ok:false} on failure. */
function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>): Action<A, R> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (...args: A) => {
      setPending(true);
      setError(null);
      try {
        return { ok: true, value: await fn(...args) };
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return { ok: false };
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  );
  return { run, pending, error };
}

export const useStartTask = () => useAction((body: StartTaskRequest) => api.startTask(body));

/** onTask receives the Task returned by 202 responses so the views do not depend on the status stream. */
export function useTaskActions(id: string, onTask?: (task: Task) => void, session?: string) {
  const report = useCallback(
    async (task: Promise<Task>) => {
      const t = await task;
      if (t && typeof t === 'object') onTask?.(t);
      return t;
    },
    [onTask],
  );
  const prompt = useAction(
    useCallback(
      (text: string) => report(session ? api.sendPrompt(id, text, session) : api.sendPrompt(id, text)),
      [id, session, report],
    ),
  );
  const answer = useAction(
    useCallback(
      (text: string, question?: string) => report(api.answer(id, { text, question, ...(session ? { session } : {}) })),
      [id, session, report],
    ),
  );
  const cancel = useAction(
    useCallback(() => report(session ? api.cancel(id, session) : api.cancel(id)), [id, session, report]),
  );
  const addSession = useAction(
    useCallback((body: AddSessionRequest) => report(api.addSession(id, body)), [id, report]),
  );
  const close = useAction(useCallback(() => report(api.close(id)), [id, report]));
  const remove = useAction(useCallback(() => api.deleteTask(id), [id]));
  return { prompt, answer, cancel, addSession, close, remove };
}

export type { Task };
