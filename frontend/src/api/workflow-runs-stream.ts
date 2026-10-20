import type { WorkflowRun } from './models';

const REOPEN_DELAY_MS = 2000;
const CLOSED = 2; // EventSource.CLOSED

export interface WorkflowRunsHandlers {
  onRun: (run: WorkflowRun) => void;
  /** Called on every (re)connect; the caller reloads the list. */
  onOpen?: () => void;
  onError?: () => void;
}

/** Opens the workflow runs stream; returns a function that closes it. A CLOSED source is reopened after a delay (like the task status stream). */
export function openWorkflowRunsStream(handlers: WorkflowRunsHandlers): () => void {
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const connect = () => {
    const es = new EventSource('/api/workflow-runs/stream');
    source = es;
    es.addEventListener('run', (e) => handlers.onRun(JSON.parse((e as MessageEvent).data) as WorkflowRun));
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
