import type { Task } from './models';

export interface TaskStatusHandlers {
  onTask: (task: Task) => void;
  onRemoved: (id: string) => void;
  /** Called on every (re)connect; the caller reloads the list. */
  onOpen?: () => void;
  onError?: () => void;
}

/** Opens the task status stream; returns a function that closes it. EventSource reconnects by itself. */
export function openTaskStatusStream(handlers: TaskStatusHandlers): () => void {
  const source = new EventSource('/api/tasks/stream');
  source.addEventListener('task', (e) => handlers.onTask(JSON.parse((e as MessageEvent).data) as Task));
  source.addEventListener('removed', (e) =>
    handlers.onRemoved((JSON.parse((e as MessageEvent).data) as { id: string }).id),
  );
  source.addEventListener('open', () => handlers.onOpen?.());
  source.addEventListener('error', () => handlers.onError?.());
  return () => source.close();
}
