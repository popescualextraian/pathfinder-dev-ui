import { useEffect, useMemo, useState } from 'react';
import type { BridgeEvent } from '../api/models';
import { openTaskEventsStream } from '../api/task-events-stream';

export type RunItem =
  | { kind: 'message'; key: number; role: string; text: string; final: boolean }
  | { kind: 'event'; key: number; event: BridgeEvent };

/** Merges consecutive non-final message chunks of one role; the final message replaces them. */
export function buildRunItems(events: BridgeEvent[]): RunItem[] {
  const items: RunItem[] = [];
  for (const event of events) {
    if (event.type !== 'message') {
      items.push({ kind: 'event', key: event.seq, event });
      continue;
    }
    const role = String(event.data.role ?? 'agent');
    const text = String(event.data.text ?? '');
    const final = event.data.final === true;
    const prev = items[items.length - 1];
    if (prev && prev.kind === 'message' && !prev.final && prev.role === role) {
      items[items.length - 1] = {
        kind: 'message',
        key: prev.key,
        role,
        final,
        text: final ? text : prev.text + text,
      };
    } else {
      items.push({ kind: 'message', key: event.seq, role, text, final });
    }
  }
  return items;
}

/** Streams the full run of a task while mounted (the stream replays from seq 0). */
export function useTaskRun(id: string) {
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setEvents([]);
    setConnected(false);
    setError(false);
    const close = openTaskEventsStream(
      id,
      (event) => {
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
          setConnected(true);
          setError(false);
        },
        onError: () => {
          setConnected(false);
          setError(true);
        },
      },
    );
    return close;
  }, [id]);

  const items = useMemo(() => buildRunItems(events), [events]);
  return { events, items, connected, error };
}
