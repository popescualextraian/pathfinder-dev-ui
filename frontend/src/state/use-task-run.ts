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
  const toolAt = new Map<unknown, number>(); // tool id -> index in items
  for (const event of events) {
    if (event.type === 'tool' && event.data.id !== undefined) {
      const at = toolAt.get(event.data.id);
      if (at !== undefined) {
        items[at] = { kind: 'event', key: items[at].key, event };
        continue;
      }
      toolAt.set(event.data.id, items.length);
      items.push({ kind: 'event', key: event.seq, event });
      continue;
    }
    if (event.type !== 'message') {
      items.push({ kind: 'event', key: event.seq, event });
      continue;
    }
    const role = String(event.data.role ?? 'agent');
    const text = String(event.data.text ?? '');
    const final = event.data.final === true;
    if (final) {
      let removed = false;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind !== 'message') continue;
        if (it.final || it.role === 'user') break;
        if (it.role === role) {
          items.splice(i, 1);
          removed = true;
        }
      }
      if (removed) {
        // indexes after a removed chunk shifted
        toolAt.clear();
        items.forEach((it, i) => {
          if (it.kind === 'event' && it.event.type === 'tool' && it.event.data.id !== undefined)
            toolAt.set(it.event.data.id, i);
        });
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

const FLUSH_MS = 50;

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
    const seen = new Set<number>();
    let buffer: BridgeEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      const batch = buffer;
      buffer = [];
      if (batch.length === 0) return;
      setEvents((prev) => {
        const next = [...prev, ...batch];
        let sorted = true;
        for (let i = prev.length > 0 ? prev.length - 1 : 1; i < next.length; i++)
          if (next[i].seq < next[i - 1].seq) sorted = false;
        return sorted ? next : next.sort((a, b) => a.seq - b.seq);
      });
    };
    let close: () => void = () => undefined;
    close = openTaskEventsStream(
      id,
      (event) => {
        // Only a real event proves the run is available; an open stream may still end in an error event.
        failures = 0;
        setConnected(true);
        setError(false);
        if (seen.has(event.seq)) return;
        seen.add(event.seq);
        buffer.push(event);
        timer ??= setTimeout(flush, FLUSH_MS);
      },
      0,
      {
        onError: () => {
          setConnected(false);
          setError(true);
          if (++failures >= MAX_FAILURES) close();
        },
      },
    );
    return () => {
      close();
      if (timer) clearTimeout(timer);
    };
  }, [id, enabled]);

  const items = useMemo(() => buildRunItems(events), [events]);
  return { events, items, connected, error };
}
