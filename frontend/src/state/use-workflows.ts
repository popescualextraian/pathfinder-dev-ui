import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/http';
import type { RefusedWorkflow, WorkflowSummary } from '../api/models';
import { deleteRefusedWorkflow, deleteWorkflow, listWorkflows, readWorkflow } from '../api/workflows-api';

/** Loads the workflow definitions once. `enabled` is false when the backend has no workflow routes (404): no error then. */
export function useWorkflows() {
  const [enabled, setEnabled] = useState(false);
  const [definitions, setDefinitions] = useState<WorkflowSummary[]>([]);
  const [refused, setRefused] = useState<RefusedWorkflow[]>([]);
  const [writable, setWritable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = useCallback((response: Awaited<ReturnType<typeof listWorkflows>>) => {
    if (!alive.current || !response) return;
    setDefinitions(response.definitions);
    setRefused(response.refused);
    setWritable(response.writable !== false);
    setEnabled(true);
  }, []);

  useEffect(() => {
    listWorkflows()
      .then(apply)
      .catch((e: unknown) => {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
  }, [apply]);

  /** Reads the list again (after the editor saved or a file was deleted). */
  const reload = useCallback(async () => {
    try {
      apply(await listWorkflows());
    } catch {
      // the list stays as it was
    }
  }, [apply]);

  /**
   * Deletes a definition with the version the list loaded (read first when the list had none), so a file changed on
   * disk since is not deleted (409: the list is reloaded). Null when done, else the message.
   */
  const remove = useCallback(
    async (id: string, version?: string): Promise<string | null> => {
      try {
        await deleteWorkflow(id, version ?? (await readWorkflow(id)).version);
        await reload();
        return null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          await reload();
          return 'The workflow file changed since the list was loaded: check it and delete again.';
        }
        return e instanceof Error ? e.message : String(e);
      }
    },
    [reload],
  );

  const removeRefused = useCallback(
    async (file: string, version: string): Promise<string | null> => {
      try {
        await deleteRefusedWorkflow(file, version);
        await reload();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [reload],
  );

  return { enabled, loading, error, definitions, refused, writable, reload, remove, removeRefused };
}
