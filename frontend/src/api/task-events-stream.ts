import type { BridgeEvent } from './models';

const RECONNECT_DELAY_MS = 2000;

/**
 * Streams the full run of a task. On error the source is closed and reopened
 * after a delay, continuing after the last seen seq. With handlers.session only that session's events arrive. Returns a function that closes it.
 */
export function openTaskEventsStream(
  taskId: string,
  onEvent: (event: BridgeEvent) => void,
  since = 0,
  handlers: {
    onOpen?: () => void;
    onError?: () => void;
    session?: string;
  } = {},
): () => void {
  let last = since;
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const sessionQuery = handlers.session ? `&session=${encodeURIComponent(handlers.session)}` : '';

  const connect = () => {
    const es = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/events/stream?since=${last}${sessionQuery}`);
    source = es;
    es.onopen = () => handlers.onOpen?.();
    es.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data) as BridgeEvent;
      if (typeof event.seq === 'number' && event.seq > last) last = event.seq;
      onEvent(event);
    };
    es.onerror = () => {
      es.close();
      if (closed) return;
      handlers.onError?.();
      if (closed) return; // the handler may have given up
      timer = setTimeout(connect, RECONNECT_DELAY_MS);
    };
  };
  connect();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    source?.close();
  };
}
