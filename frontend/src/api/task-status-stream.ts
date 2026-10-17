import type { Task } from './models';

const REOPEN_DELAY_MS = 2000;
const CLOSED = 2; // EventSource.CLOSED

export interface TaskStatusHandlers {
  onTask: (task: Task) => void;
  onRemoved: (id: string) => void;
  /** Called on every (re)connect; the caller reloads the list. */
  onOpen?: () => void;
  onError?: () => void;
}

/**
 * Opens the task status stream; returns a function that closes it. EventSource retries by itself
 * after a dropped connection, but not once it is CLOSED (non-200 or wrong content type): then the
 * source is reopened after a delay.
 */
export function openTaskStatusStream(handlers: TaskStatusHandlers): () => void {
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const connect = () => {
    const es = new EventSource('/api/tasks/stream');
    source = es;
    es.addEventListener('task', (e) => handlers.onTask(JSON.parse((e as MessageEvent).data) as Task));
    es.addEventListener('removed', (e) =>
      handlers.onRemoved((JSON.parse((e as MessageEvent).data) as { id: string }).id),
    );
    es.addEventListener('open', () => handlers.onOpen?.());
    es.addEventListener('error', () => {
      if (stopped) return;
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
