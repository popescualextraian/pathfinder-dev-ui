import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScheduleInput, ScheduleRecord, ScheduleResult, ScheduleSummary } from '../api/models';
import {
  getSchedule, listSchedules, removeSchedule, replaceSchedule, runSchedule,
} from '../api/schedules-api';

export const SCHEDULES_REFRESH_MS = 30_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs `load` now and every 30 s while mounted; a failed refresh keeps the data and sets the error. */
function useRefreshed(load: () => Promise<void>, key: unknown) {
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    void loadRef.current();
    const timer = setInterval(() => void loadRef.current(), SCHEDULES_REFRESH_MS);
    return () => clearInterval(timer);
  }, [key]);
}

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/** Pending flag and error for actions; each returns true when it worked. */
function useActions() {
  const alive = useAlive();
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const act = useCallback(
    async <T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
      setPending(true);
      setActionError(null);
      try {
        return { ok: true, value: await fn() };
      } catch (e) {
        if (alive.current) setActionError(message(e));
        return { ok: false };
      } finally {
        if (alive.current) setPending(false);
      }
    },
    [alive],
  );
  return { pending, actionError, act };
}

/** The schedule list, refreshed every 30 s while mounted. */
export function useSchedules() {
  const alive = useAlive();
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { pending, actionError, act } = useActions();

  const reload = useCallback(async () => {
    try {
      const list = await listSchedules();
      if (!alive.current) return;
      setSchedules(list);
      setError(null);
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [alive]);
  useRefreshed(reload, null);

  /** Runs now; the result (possibly skipped or refused) is returned, the list reloaded. */
  const run = useCallback(
    async (id: string): Promise<ScheduleResult | null> => {
      const r = await act(() => runSchedule(id));
      await reload();
      return r.ok ? r.value : null;
    },
    [act, reload],
  );
  /** Enables or disables by replacing the schedule with its other fields unchanged. */
  const toggle = useCallback(
    async (schedule: ScheduleSummary, enabled: boolean): Promise<boolean> => {
      const r = await act(() => replaceSchedule(schedule.id, toInput(schedule, enabled)));
      await reload();
      return r.ok;
    },
    [act, reload],
  );
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const r = await act(() => removeSchedule(id));
      await reload();
      return r.ok;
    },
    [act, reload],
  );

  return { schedules, loading, error, pending, actionError, reload, run, toggle, remove };
}

export function toInput(s: ScheduleInput & { enabled?: boolean }, enabled: boolean): ScheduleInput {
  const input: ScheduleInput = {
    title: s.title, prompt: s.prompt, repository: s.repository, when: s.when,
    timeoutMinutes: s.timeoutMinutes, enabled,
  };
  if (s.ref !== undefined) input.ref = s.ref;
  if (s.model !== undefined) input.model = s.model;
  return input;
}

/** One schedule with its results, refreshed every 30 s while mounted; `notFound` after a 404. */
export function useSchedule(id: string) {
  const alive = useAlive();
  const [schedule, setSchedule] = useState<ScheduleRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { pending, actionError, act } = useActions();

  const reload = useCallback(async () => {
    try {
      const record = await getSchedule(id);
      if (!alive.current) return;
      setSchedule(record);
      setError(null);
      setNotFound(false);
    } catch (e) {
      if (!alive.current) return;
      if ((e as { status?: number }).status === 404) setNotFound(true);
      setError(message(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [alive, id]);
  useEffect(() => {
    setSchedule(null);
    setLoading(true);
    setError(null);
    setNotFound(false);
  }, [id]);
  useRefreshed(reload, id);

  const run = useCallback(async (): Promise<ScheduleResult | null> => {
    const r = await act(() => runSchedule(id));
    await reload();
    return r.ok ? r.value : null;
  }, [act, reload, id]);
  const toggle = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      if (!schedule) return false;
      const r = await act(() => replaceSchedule(id, toInput(schedule, enabled)));
      if (r.ok && alive.current) setSchedule(r.value);
      return r.ok;
    },
    [act, schedule, id, alive],
  );
  const remove = useCallback(async (): Promise<boolean> => (await act(() => removeSchedule(id))).ok, [act, id]);

  return { schedule, loading, error, notFound, pending, actionError, reload, run, toggle, remove };
}
