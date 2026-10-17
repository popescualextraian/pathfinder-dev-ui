import { useEffect, useRef, useState } from 'react';
import type { Repository, Task } from '../api/models';
import { useStartTask } from '../state/use-task-actions';
import { Button } from './Button';
import styles from './TaskView.module.css';

interface Props {
  repositories: Repository[];
  /** Active repository filter; preselected when it names a known repository. */
  defaultRepository?: string | null;
  onClose: () => void;
  onStarted: (task: Task) => void;
}

export function NewTaskDialog({ repositories, defaultRepository, onClose, onStarted }: Props) {
  const start = useStartTask();
  const first = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [repository, setRepository] = useState('');
  const [model, setModel] = useState('');
  const filtered = repositories.find((r) => r.name === defaultRepository)?.name;
  const effectiveRepository =
    repository || filtered || repositories.find((r) => r.default)?.name || repositories[0]?.name || '';

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
    if (!prompt.trim() || start.pending) return;
    const result = await start.run({
      prompt: prompt.trim(),
      ...(title.trim() && { title: title.trim() }),
      ...(effectiveRepository && { repository: effectiveRepository }),
      ...(model.trim() && { model: model.trim() }),
    });
    if (result.ok && result.value) onStarted(result.value);
  };

  return (
    <div className={styles.dialog}>
      <form
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-task-heading"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="new-task-heading">New task</h2>
        <label className={styles.field}>
          Title
          <input ref={first} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className={styles.field}>
          Prompt
          <textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
        </label>
        <label className={styles.field}>
          Repository
          <select value={effectiveRepository} onChange={(e) => setRepository(e.target.value)}>
            {repositories.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Model (optional)
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        {start.error && (
          <p role="alert" className={styles.error}>
            {start.error}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={start.pending || !prompt.trim()}>
            Start task
          </Button>
        </div>
      </form>
    </div>
  );
}
