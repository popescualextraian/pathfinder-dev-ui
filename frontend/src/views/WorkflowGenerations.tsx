import { useState } from 'react';
import type { WorkflowGenerationSummary } from '../api/models';
import type { GenerationActionState } from '../state/use-workflow-generations';
import { Button } from './Button';
import { Dialog, dialogStyles } from './Dialog';
import { GenerationPanel } from './GenerationPanel';
import styles from './WorkflowGenerations.module.css';

/** Most characters of a description (the backend's limit). */
export const MAX_DESCRIPTION = 4000;
const COST_NOTE = 'Runs an agent task on the default repository: it costs tokens.';

type Result = Promise<{ ok: boolean }>;

interface Props {
  generations: WorkflowGenerationSummary[];
  /** Listing failed. */
  error: string | null;
  startState: GenerationActionState;
  actionState: (id: string) => GenerationActionState;
  start: (description: string, model?: string) => Result;
  requestChanges: (id: string, text: string) => Result;
  discard: (id: string) => Result;
  answer: (generation: WorkflowGenerationSummary, text: string) => Result;
}

/** "Generate with AI" and one panel per open generation (above the workflow list; only when the folder is writable). */
export function WorkflowGenerations({ generations, error, startState, actionState, start, requestChanges, discard, answer }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className={styles.section} aria-label="Generations">
      <div className={styles.bar}>
        <Button onClick={() => setOpen(true)}>Generate with AI</Button>
        <span className={styles.note}>{COST_NOTE}</span>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {generations.length > 0 && (
        <ul className={styles.panels}>
          {generations.map((g) => (
            <li key={g.id}>
              <GenerationPanel
                generation={g}
                action={actionState(g.id)}
                onAnswer={(text) => answer(g, text)}
                onRequestChanges={(text) => requestChanges(g.id, text)}
                onDiscard={() => void discard(g.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {open && (
        <GenerateDialog
          pending={startState.pending}
          error={startState.error}
          onStart={start}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

interface DialogProps {
  pending: boolean;
  error: string | null;
  onStart: (description: string, model?: string) => Result;
  onClose: () => void;
}

function GenerateDialog({ pending, error, onStart, onClose }: DialogProps) {
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('');
  const ready = description.trim() !== '' && !pending;

  const submit = async () => {
    if (!ready) return;
    const m = model.trim();
    const r = await (m ? onStart(description.trim(), m) : onStart(description.trim()));
    if (r.ok) onClose();
  };

  return (
    <Dialog title="Generate a workflow with AI" onClose={onClose} wide initialFocus="textarea">
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className={styles.field}>
          <span>Describe the workflow</span>
          <textarea
            rows={12}
            maxLength={MAX_DESCRIPTION}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="The steps, who checks what, which lanes the item moves through…"
          />
        </label>
        <label className={styles.field}>
          <span>Model (optional)</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="default" />
        </label>
        <p className={dialogStyles.message}>{COST_NOTE}</p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={dialogStyles.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!ready}>
            {pending ? 'Starting…' : 'Start'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
