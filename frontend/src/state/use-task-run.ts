import { useEffect, useMemo, useState } from 'react';
import type { BridgeEvent } from '../api/models';
import { openTaskEventsStream } from '../api/task-events-stream';

export type RunItem =
  | { kind: 'message'; key: number; role: string; text: string; final: boolean }
  | { kind: 'event'; key: number; event: BridgeEvent };

/**
 * Builds the transcript. A final message carries the whole text of its turn, so it replaces the
 * non-final chunks of its role since the last final or user message; chunks without a final yet
 * show merged when adjacent. Tool events repeat per status: one row per tool id, updated in place.
 */
export function buildRunItems(events: BridgeEvent[]): RunItem[] {
  const items: RunItem[] = [];
  for (const event of events) {
    if (event.type === 'tool' && event.data.id !== undefined) {
      const at = items.findIndex(
        (i) => i.kind === 'event' && i.event.type === 'tool' && i.event.data.id === event.data.id,
      );
      if (at >= 0) {
        items[at] = { kind: 'event', key: items[at].key, event };
        continue;
      }
    }
    if (event.type !== 'message') {
      items.push({ kind: 'event', key: event.seq, event });
      continue;
    }
    const role = String(event.data.role ?? 'agent');
    const text = String(event.data.text ?? '');
    const final = event.data.final === true;
    if (final) {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind !== 'message') continue;
        if (it.final || it.role === 'user') break;
        if (it.role === role) items.splice(i, 1);
      }
      items.push({ kind: 'message', key: event.seq, role, text, final });
      continue;
    }
    const prev = items[items.length - 1];
    if (prev && prev.kind === 'message' && !prev.final && prev.role === role) {
      items[items.length - 1] = { ...prev, text: prev.text + text };
    } else {
      items.push({ kind: 'message', key: event.seq, role, text, final });
    }
  }
  return items;
}

/** Streams the full run of a task while mounted (the stream replays from seq 0). */
const MAX_FAILURES = 5;

export function useTaskRun(id: string, enabled = true) {
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(!enabled);

  useEffect(() => {
    setEvents([]);
    setConnected(false);
    setError(!enabled);
    if (!enabled) return;
    let failures = 0;
    let close: () => void = () => undefined;
    close = openTaskEventsStream(
      id,
      (event) => {
        failures = 0;
        setConnected(true);
        setError(false);
        setEvents((prev) => {
          if (prev.some((e) => e.seq === event.seq)) return prev;
          const next = [...prev, event];
          return event.seq < (prev[prev.length - 1]?.seq ?? 0) ? next.sort((a, b) => a.seq - b.seq) : next;
        });
      },
      0,
      {
        onOpen: () => {
          failures = 0;
          setConnected(true);
          setError(false);
        },
        onError: () => {
          setConnected(false);
          setError(true);
          if (++failures >= MAX_FAILURES) close();
        },
      },
    );
    return close;
  }, [id, enabled]);

  const items = useMemo(() => buildRunItems(events), [events]);
  return { events, items, connected, error };
}
