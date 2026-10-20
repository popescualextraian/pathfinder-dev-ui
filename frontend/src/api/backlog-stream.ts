import type { BacklogItem } from './models';

const REOPEN_DELAY_MS = 2000;
const CLOSED = 2; // EventSource.CLOSED

export interface BacklogStreamHandlers {
  onItem: (item: BacklogItem) => void;
  onRemoved: (id: string) => void;
  /** Called on every (re)connect; the caller reloads the list. */
  onOpen?: () => void;
  /** Connection error. */
  onError?: () => void;
  /** The backend's `error` data event (the source could not be read). */
  onServerError?: (message: string) => void;
}

/**
 * Opens the backlog stream; returns a function that closes it. The backend's data event `error`
 * shares its name with EventSource's own connection error: only a MessageEvent with data is a
 * server message. Like the task status stream, a CLOSED source is reopened after a delay.
 */
export function openBacklogStream(handlers: BacklogStreamHandlers): () => void {
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const connect = () => {
    const es = new EventSource('/api/backlog/stream');
    source = es;
    es.addEventListener('item', (e) => handlers.onItem(JSON.parse((e as MessageEvent).data) as BacklogItem));
    es.addEventListener('removed', (e) =>
      handlers.onRemoved((JSON.parse((e as MessageEvent).data) as { id: string }).id),
    );
    es.addEventListener('open', () => handlers.onOpen?.());
    es.addEventListener('error', (e) => {
      if (stopped) return;
      if (e instanceof MessageEvent && typeof e.data === 'string') {
        try {
          handlers.onServerError?.((JSON.parse(e.data) as { message: string }).message);
        } catch {
          handlers.onServerError?.(e.data);
        }
        return;
      }
      handlers.onError?.();
      if (es.readyState === CLOSED) {
        es.close();
        timer = setTimeout(connect, REOPEN_DELAY_MS);
      }
    });
  };
  connect();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    source?.close();
  };
}
