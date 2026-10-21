import { useState, type ReactNode } from 'react';
import type { RefusedWorkflow, WorkflowSummary } from '../api/models';
import { Button } from './Button';
import { ConfirmDialog } from './Dialog';
import styles from './WorkflowList.module.css';

interface Props {
  definitions: WorkflowSummary[];
  refused: RefusedWorkflow[];
  /** False when the definitions folder is read-only: write actions are hidden. */
  writable: boolean;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  /** With the version the list loaded; resolves with null when deleted, else the error message. */
  onDelete: (id: string, version?: string) => Promise<string | null>;
  onDeleteRefused: (file: string, version: string) => Promise<string | null>;
  /** Shown above the list (the AI generations; only given when the folder is writable). */
  generations?: ReactNode;
}

type Pending = { kind: 'workflow'; id: string; title: string; version?: string } | { kind: 'file'; file: string; version: string };

export function WorkflowList({
  definitions, refused, writable, onNew, onEdit, onDuplicate, onDelete, onDeleteRefused, generations,
}: Props) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    const what = pending;
    setPending(null);
    if (!what) return;
    const result = what.kind === 'workflow' ? await onDelete(what.id, what.version) : await onDeleteRefused(what.file, what.version);
    setError(result);
  };

  return (
    <section className={styles.list} aria-label="Workflows">
      <header className={styles.header}>
        <h1>Workflows</h1>
        {writable && (
          <Button variant="primary" onClick={onNew}>
            New workflow
          </Button>
        )}
      </header>
      {!writable && (
        <p className={styles.notice} role="status">
          The workflows folder is read-only: definitions can be viewed but not changed.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {generations}
      {definitions.length === 0 && refused.length === 0 && <p className={styles.empty}>No workflows yet.</p>}
      <ul className={styles.rows}>
        {definitions.map((d) => (
          <li key={d.id} className={styles.row} data-testid={`workflow-row-${d.id}`}>
            <div className={styles.text}>
              <span className={styles.title}>{d.title}</span>
              <code className={styles.id}>{d.id}</code>
              <span className={styles.steps}>{d.steps.map((s) => s.title).join(' → ')}</span>
            </div>
            <div className={styles.actions}>
              <Button onClick={() => onEdit(d.id)} aria-label={`${writable ? 'Edit' : 'View'} ${d.title}`}>
                {writable ? 'Edit' : 'View'}
              </Button>
              {writable && (
                <>
                  <Button onClick={() => onDuplicate(d.id)} aria-label={`Duplicate ${d.title}`}>
                    Duplicate
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => setPending({ kind: 'workflow', id: d.id, title: d.title, version: d.version })}
                    aria-label={`Delete ${d.title}`}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
        {refused.map((r) => (
          <li key={r.file} className={`${styles.row} ${styles.refused}`} data-testid={`workflow-refused-${r.file}`}>
            <div className={styles.text}>
              <code className={styles.id}>{r.file}</code>
              <span className={styles.problem}>{r.error}</span>
            </div>
            {writable && r.version !== undefined && (
              <div className={styles.actions}>
                <Button
                  variant="danger"
                  onClick={() => setPending({ kind: 'file', file: r.file, version: r.version as string })}
                  aria-label={`Delete file ${r.file}`}
                >
                  Delete
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {pending && (
        <ConfirmDialog
          title={pending.kind === 'workflow' ? `Delete workflow "${pending.title}"?` : `Delete file ${pending.file}?`}
          message={pending.kind === 'workflow' ? 'The definition file is removed. Runs that already started keep their copy.' : 'The refused file is removed.'}
          confirmLabel="Delete"
          danger
          onConfirm={() => void confirm()}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}
