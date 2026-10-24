import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskRunInput, WorkflowRun, WorkflowRunState } from '../api/models';
import { advanceRun, listRuns, startRun, startTask as startTaskRun, stopRun } from '../api/workflows-api';
import { openWorkflowRunsStream } from '../api/workflow-runs-stream';

const ACTIVE: readonly WorkflowRunState[] = ['running', 'needs-you', 'awaiting-approval', 'blocked'];
export const isActiveRun = (run: Pick<WorkflowRun, 'state'>) => ACTIVE.includes(run.state);

const oldestFirst = (a: WorkflowRun, b: WorkflowRun) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;

/** Inserts or replaces a run unless the list already holds a newer copy (by updatedAt). */
export function upsertRun(list: WorkflowRun[], run: WorkflowRun): WorkflowRun[] {
  const current = list.find((r) => r.id === run.id);
  if (current && current.updatedAt > run.updatedAt) return list;
  return [...list.filter((r) => r.id !== run.id), run].sort(oldestFirst);
}

/** The run a view shows: the active one, else the most recent. */
function pick(candidates: WorkflowRun[]): WorkflowRun | undefined {
  const active = candidates.filter(isActiveRun);
  const pool = active.length ? active : candidates;
  return pool.reduce<WorkflowRun | undefined>((best, r) => (!best || r.createdAt >= best.createdAt ? r : best), undefined);
}

export interface RunActionState {
  pending: boolean;
  error: string | null;
}
const IDLE: RunActionState = { pending: false, error: null };

/**
 * Loads the runs (when `enabled`), keeps them current from the runs stream and reloads on every (re)connect.
 * Actions return `{ok, value}` (never reject); pending/error are kept per work item (`actionState(itemId)`).
 */
export function useWorkflowRuns(enabled: boolean) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  // A load succeeded since the hook was enabled: until then runsByItem may miss active runs.
  const [loaded, setLoaded] = useState(false);
  const [actions, setActions] = useState<Record<string, RunActionState>>({});
  const latestLoad = useRef(0);
  // Changes seen on the stream while a load runs: the (older) GET must not undo them.
  const touched = useRef(new Map<string, WorkflowRun>());
  const runsRef = useRef<WorkflowRun[]>([]);
  runsRef.current = runs;

  const load = useCallback(() => {
    const seq = ++latestLoad.current;
    touched.current = new Map();
    return listRuns()
      .then((list) => {
        if (seq !== latestLoad.current) return;
        const seen = touched.current;
        setRuns((current) => {
          let merged = list.map((r) => {
            const mine = current.find((c) => c.id === r.id);
            return mine && mine.updatedAt > r.updatedAt ? mine : r;
          });
          for (const [id, run] of seen) merged = [...merged.filter((r) => r.id !== id), run];
          return merged.sort(oldestFirst);
        });
        setError(null);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (seq === latestLoad.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (seq === latestLoad.current) setLoading(false);
      });
  }, []);

  const applyRun = useCallback((run: WorkflowRun) => {
    touched.current.set(run.id, run);
    setRuns((list) => upsertRun(list, run));
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setLoaded(false);
      return;
    }
    const stop = openWorkflowRunsStream({ onOpen: () => void load(), onRun: applyRun });
    void load();
    return stop;
  }, [enabled, load, applyRun]);

  const runsByItem = useMemo(() => {
    const byItem = new Map<string, WorkflowRun[]>();
    for (const r of runs) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
    const out = new Map<string, WorkflowRun>();
    for (const [id, list] of byItem) out.set(id, pick(list)!);
    return out;
  }, [runs]);

  const runByTask = useCallback(
    (taskId: string) => pick(runs.filter((r) => r.taskId === taskId)),
    [runs],
  );

  const actionState = useCallback((itemId: string): RunActionState => actions[itemId] ?? IDLE, [actions]);

  const perform = useCallback(
    async (itemId: string, call: () => Promise<WorkflowRun>) => {
      setActions((a) => ({ ...a, [itemId]: { pending: true, error: null } }));
      try {
        const run = await call();
        applyRun(run);
        setActions((a) => ({ ...a, [itemId]: IDLE }));
        return { ok: true as const, value: run };
      } catch (e) {
        setActions((a) => ({ ...a, [itemId]: { pending: false, error: e instanceof Error ? e.message : String(e) } }));
        return { ok: false as const };
      }
    },
    [applyRun],
  );

  const itemOf = (runId: string) => runsRef.current.find((r) => r.id === runId)?.itemId ?? runId;

  const start = useCallback((itemId: string, workflowId: string) => perform(itemId, () => startRun(itemId, workflowId)), [perform]);
  const startTask = useCallback(
    (itemId: string, input: TaskRunInput) => perform(itemId, () => startTaskRun(itemId, input)),
    [perform],
  );
  const advance = useCallback(
    (runId: string, force?: boolean) =>
      perform(itemOf(runId), () => (force === undefined ? advanceRun(runId) : advanceRun(runId, force))),
    [perform],
  );
  const stop = useCallback((runId: string) => perform(itemOf(runId), () => stopRun(runId)), [perform]);

  return { runs, loading, loaded, error, runsByItem, runByTask, actionState, start, startTask, advance, stop };
}
