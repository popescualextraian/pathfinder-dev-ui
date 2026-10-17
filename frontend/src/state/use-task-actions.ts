import { useCallback, useState } from 'react';
import type { StartTaskRequest, Task } from '../api/models';
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

export function useTaskActions(id: string) {
  const prompt = useAction(useCallback((text: string) => api.sendPrompt(id, text), [id]));
  const answer = useAction(useCallback((text: string, question?: string) => api.answer(id, { text, question }), [id]));
  const cancel = useAction(useCallback(() => api.cancel(id), [id]));
  const close = useAction(useCallback(() => api.close(id), [id]));
  const remove = useAction(useCallback(() => api.deleteTask(id), [id]));
  return { prompt, answer, cancel, close, remove };
}

export type { Task };
