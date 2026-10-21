import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/http';
import type { ScheduleInput, ScheduleRecord, ScheduleWhen } from '../api/models';
import { createSchedule, previewSchedule, replaceSchedule } from '../api/schedules-api';

export const PREVIEW_DELAY_MS = 400;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface SchedulePreviewState {
  /** SCHEDULES_TIMEZONE, once a preview answered. */
  zone: string | null;
  next: string[];
  error: string | null;
  loading: boolean;
}

/** The next times of `when`, asked `delayMs` after the last change; null asks nothing. */
export function useSchedulePreview(when: ScheduleWhen | null, delayMs = PREVIEW_DELAY_MS): SchedulePreviewState {
  const key = when ? JSON.stringify(when) : null;
  const [state, setState] = useState<SchedulePreviewState>({ zone: null, next: [], error: null, loading: false });
  useEffect(() => {
    if (key === null) {
      setState((s) => ({ ...s, next: [], error: null, loading: false }));
      return;
    }
    let current = true;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      previewSchedule(JSON.parse(key) as ScheduleWhen).then(
        (p) => current && setState({ zone: p.zone, next: p.next, error: null, loading: false }),
        (e) => current && setState((s) => ({ ...s, next: [], error: message(e), loading: false })),
      );
    }, delayMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, delayMs]);
  return state;
}

/** Create (`id` null) or replace; the error keeps the field the backend named. */
export function useScheduleSave() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  const save = useCallback(async (id: string | null, input: ScheduleInput): Promise<ScheduleRecord | null> => {
    setPending(true);
    setError(null);
    setField(null);
    try {
      return id === null ? await createSchedule(input) : await replaceSchedule(id, input);
    } catch (e) {
      if (alive.current) {
        setError(message(e));
        setField(e instanceof ApiError ? (e.location?.field ?? null) : null);
      }
      return null;
    } finally {
      if (alive.current) setPending(false);
    }
  }, []);

  return { save, pending, error, field };
}
