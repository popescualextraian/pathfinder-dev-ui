import { useEffect, useRef, useState } from 'react';
import type { Repository, TaskRunInput } from '../api/models';
import { useStartTask } from '../state/use-task-actions';
import { Button } from './Button';
import styles from './TaskView.module.css';

interface Props {
  repositories: Repository[];
  /** Active repository filter; preselected when it names a known repository. */
  defaultRepository?: string | null;
  onClose: () => void;
  /** Receives the id of the started task. */
  onStarted: (taskId: string) => void;
  /** Default "New task". */
  heading?: string;
  /** Prefilled (editable) fields. */
  initial?: { title?: string; prompt?: string };
  /**
   * Starts the task in place of a plain `POST /api/tasks` (e.g. linked to a work item); resolves to the task id,
   * or null when it failed (its error then comes in `submitState`).
   */
  submit?: (input: TaskRunInput) => Promise<string | null>;
  submitState?: { pending: boolean; error: string | null };
}

export function NewTaskDialog({
  repositories, defaultRepository, onClose, onStarted, heading = 'New task', initial, submit: submitOther, submitState,
}: Props) {
  const start = useStartTask();
  const first = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
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

  // An earlier action's error on the same item is not this dialog's: show the error only after a submit here.
  const [submitted, setSubmitted] = useState(false);
  const pending = submitOther ? (submitState?.pending ?? false) : start.pending;
  const error = submitOther ? submitted ? (submitState?.error ?? null) : null : start.error;

  const submit = async () => {
    if (!prompt.trim() || pending) return;
    const input: TaskRunInput = {
      prompt: prompt.trim(),
      ...(title.trim() && { title: title.trim() }),
      ...(effectiveRepository && { repository: effectiveRepository }),
      ...(model.trim() && { model: model.trim() }),
    };
    if (submitOther) {
      setSubmitted(true);
      const taskId = await submitOther(input);
      if (taskId) onStarted(taskId);
      return;
    }
    const result = await start.run(input);
    if (result.ok && result.value) onStarted(result.value.id);
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
        <h2 id="new-task-heading">{heading}</h2>
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
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending || !prompt.trim()}>
            Start task
          </Button>
        </div>
      </form>
    </div>
  );
}
