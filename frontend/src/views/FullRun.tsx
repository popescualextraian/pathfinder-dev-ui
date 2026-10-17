import { useState } from 'react';
import { useTaskRun, type RunItem } from '../state/use-task-run';
import styles from './FullRun.module.css';

function str(v: unknown): string {
  return v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
}

function ToolLine({ data }: { data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const tail = str(data.output_tail);
  return (
    <div className={styles.tool}>
      <button type="button" className={styles.toolButton} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> <strong>{str(data.title) || 'tool'}</strong>
        <span className={styles.meta}>
          {str(data.kind)} · {str(data.status)}
        </span>
      </button>
      {open && <pre className={styles.output}>{tail || '(no output)'}</pre>}
    </div>
  );
}

function Line({ item }: { item: RunItem }) {
  if (item.kind === 'message') {
    return (
      <div className={`${styles.message} ${item.role === 'user' ? styles.user : styles.agent}`}>
        <span className={styles.role}>{item.role === 'user' ? 'You' : 'Agent'}</span>
        <p className={styles.text}>{item.text}</p>
      </div>
    );
  }
  const { event } = item;
  const d = event.data;
  switch (event.type) {
    case 'tool':
      return <ToolLine data={d} />;
    case 'plan': {
      const entries = Array.isArray(d.entries) ? (d.entries as unknown[]) : [];
      return (
        <div className={styles.line}>
          <span className={styles.label}>plan</span>
          <ul className={styles.plan}>
            {entries.map((e, i) => {
              const o = (typeof e === 'object' && e ? e : {}) as Record<string, unknown>;
              const text = str(o.content ?? o.text ?? o.title ?? e);
              return (
                <li key={i}>
                  {text}
                  {o.status ? <span className={styles.meta}> ({str(o.status)})</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      );
    }
    case 'state':
      return (
        <div className={styles.line}>
          <span className={styles.label}>state</span> {str(d.state ?? d.status ?? d.value ?? d)}
        </div>
      );
    case 'question':
      return (
        <div className={styles.line}>
          <span className={styles.label}>question</span> {str(d.text ?? d.question ?? d)}
        </div>
      );
    case 'answer':
      return (
        <div className={styles.line}>
          <span className={styles.label}>answer</span> {str(d.text)}
          {d.grant ? <span className={styles.meta}> (grant {str(d.grant)})</span> : null}
        </div>
      );
    case 'gate':
      return (
        <div className={styles.line}>
          <span className={styles.label}>gate</span> {str(d.rule)} <code>{str(d.command)}</code>
        </div>
      );
    case 'error':
      return (
        <div className={`${styles.line} ${styles.errorLine}`}>
          <span className={styles.label}>error</span> {str(d.message)}
        </div>
      );
    default:
      return null;
  }
}

/** The full run of a task; the event stream is open only while this is mounted. */
export function FullRun({ taskId, closed = false }: { taskId: string; closed?: boolean }) {
  const { items, connected, error } = useTaskRun(taskId, !closed);
  return (
    <section className={styles.run} data-testid="full-run" aria-label="Full run">
      <h3 className={styles.kicker}>Full run</h3>
      {error && !connected && (
        <p className={styles.note} role="status">
          Run not available (container not running)
        </p>
      )}
      {!error && items.length === 0 && <p className={styles.note}>{connected ? 'No events yet.' : 'Loading…'}</p>}
      {items.map((item) => (
        <Line key={`${item.kind}-${item.key}`} item={item} />
      ))}
    </section>
  );
}
