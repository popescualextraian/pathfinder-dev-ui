import { useEffect, useRef, useState } from 'react';
import type { SessionView, Task } from '../api/models';
import { useTaskActions } from '../state/use-task-actions';
import { Button } from './Button';
import styles from './TaskView.module.css';

export const SESSION_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

interface Props {
  taskId: string;
  sessions: SessionView[];
  onClose: () => void;
  /** Called with the task returned by the API and the new session's name. */
  onAdded: (task: Task, name: string) => void;
  /** Receives the Task returned by the API (upsert into the list). */
  onTask?: (task: Task) => void;
}

export function AddSessionDialog({ taskId, sessions, onClose, onAdded, onTask }: Props) {
  const { addSession } = useTaskActions(taskId, onTask);
  const first = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [forkFrom, setForkFrom] = useState('');
  const [prompt, setPrompt] = useState('');
  const valid = SESSION_NAME.test(name);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = async () => {
    if (!valid || addSession.pending) return;
    const result = await addSession.run({
      name,
      ...(model.trim() && { model: model.trim() }),
      ...(forkFrom && { forkFrom }),
      ...(prompt.trim() && { prompt: prompt.trim() }),
    });
    if (result.ok && result.value) onAdded(result.value, name);
  };

  return (
    <div className={styles.dialog}>
      <form
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-session-heading"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="add-session-heading">New session</h2>
        <label className={styles.field}>
          Name
          <input
            ref={first}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={name !== '' && !valid}
            maxLength={64}
          />
        </label>
        {name !== '' && !valid && (
          <p className={styles.error}>
            Use lowercase letters, digits, - and _ (up to 32 characters, starting with a letter or digit).
          </p>
        )}
        <label className={styles.field}>
          Model (optional)
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className={styles.field}>
          Copy conversation from
          <select value={forkFrom} onChange={(e) => setForkFrom(e.target.value)}>
            <option value="">Start fresh</option>
            {sessions.map((s) => (
              <option key={s.name} value={s.name} disabled={s.state !== 'idle'}>
                {s.name}
                {s.state !== 'idle' ? ` (${s.state}, not idle)` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          First prompt (optional)
          <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>
        {addSession.error && (
          <p role="alert" className={styles.error}>
            {addSession.error}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={addSession.pending || !valid}>
            Create session
          </Button>
        </div>
      </form>
    </div>
  );
}
