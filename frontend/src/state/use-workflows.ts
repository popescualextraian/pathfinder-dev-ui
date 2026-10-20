import { useEffect, useState } from 'react';
import type { RefusedWorkflow, WorkflowSummary } from '../api/models';
import { listWorkflows } from '../api/workflows-api';

/** Loads the workflow definitions once. `enabled` is false when the backend has no workflow routes (404): no error then. */
export function useWorkflows() {
  const [enabled, setEnabled] = useState(false);
  const [definitions, setDefinitions] = useState<WorkflowSummary[]>([]);
  const [refused, setRefused] = useState<RefusedWorkflow[]>([]);
  const [writable, setWritable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listWorkflows()
      .then((response) => {
        if (cancelled) return;
        if (response) {
          setDefinitions(response.definitions);
          setRefused(response.refused);
          setWritable(response.writable !== false);
          setEnabled(true);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { enabled, loading, error, definitions, refused, writable };
}
