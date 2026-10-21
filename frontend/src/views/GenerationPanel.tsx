import { useState } from 'react';
import type { WorkflowGenerationSummary, WorkflowValidationError } from '../api/models';
import { buildHash } from '../state/use-route';
import { Button } from './Button';
import { formatCost } from './format-cost';
import styles from './GenerationPanel.module.css';

/** Fixes the backend sends before it gives up (the generator's limit). */
export const MAX_FIX_ATTEMPTS = 2;
const DESCRIPTION_MAX = 120;
const MESSAGE_MAX = 200;

type Result = Promise<{ ok: boolean }>;

interface Props {
  generation: WorkflowGenerationSummary;
  /** Pending/error of this generation's last action. */
  action: { pending: boolean; error: string | null };
  onAnswer: (text: string) => Result;
  onRequestChanges: (text: string) => Result;
  onDiscard: () => void;
}

/** Whitespace collapsed, cut to `max` characters with an ellipsis. */
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function stateInWords(g: WorkflowGenerationSummary): string {
  switch (g.state) {
    case 'writing':
      return 'writing…';
    case 'asking':
      return 'asking';
    case 'fixing':
      return `fixing ${g.attempts} of ${MAX_FIX_ATTEMPTS}…`;
    case 'ready':
      return 'draft ready';
    case 'failed':
      return 'failed';
    default:
      return g.state;
  }
}

/** One validation error with its place: `build · prompt: ...`, `step 3: ...`. */
export function errorLine(e: WorkflowValidationError): string {
  const step = e.stepId ?? (e.stepIndex !== undefined ? `step ${e.stepIndex + 1}` : undefined);
  const place = [step, e.field].filter(Boolean).join(' · ');
  return place ? `${place}: ${e.message}` : e.message;
}

const editorHref = (id: string) => buildHash({ repository: null, taskId: null, session: null, view: 'workflows', workflow: 'new', generation: id });
const taskHref = (taskId: string) => buildHash({ repository: null, taskId, session: null, view: 'tasks' });

/** One open workflow generation on the Workflows page: progress, the agent's question, the result and its actions. */
export function GenerationPanel({ generation: g, action, onAnswer, onRequestChanges, onDiscard }: Props) {
  const [answer, setAnswer] = useState('');
  const [changes, setChanges] = useState('');
  const working = g.state === 'writing' || g.state === 'asking' || g.state === 'fixing';
  const busy = action.pending;

  const sendAnswer = async (text: string, clear: boolean) => {
    if (!text.trim() || busy) return;
    const r = await onAnswer(text.trim());
    if (r.ok && clear) setAnswer('');
  };
  const sendChanges = async () => {
    if (!changes.trim() || busy) return;
    const r = await onRequestChanges(changes.trim());
    if (r.ok) setChanges('');
  };

  return (
    <article className={styles.panel} data-testid={`generation-${g.id}`} aria-label={`Generation ${g.id}`}>
      <header className={styles.header}>
        <span className={styles.description} title={g.description} data-testid="generation-description">
          {shorten(g.description, DESCRIPTION_MAX)}
        </span>
        <span className={`${styles.state} ${styles[g.state] ?? ''}`} data-testid="generation-state">
          {stateInWords(g)}
        </span>
      </header>

      <div className={styles.facts}>
        {g.cost && <span data-testid="generation-cost">Cost so far: {formatCost(g.cost).usd}</span>}
        {g.model && <span>Model: {g.model}</span>}
        <a href={taskHref(g.taskId)}>open task</a>
      </div>

      {g.warning && (
        <p className={styles.warning} data-testid="generation-warning">
          Warning: {g.warning}
        </p>
      )}

      {working && g.lastMessage && (
        <p className={styles.message} data-testid="generation-last-message" title={g.lastMessage}>
          {shorten(g.lastMessage, MESSAGE_MAX)}
        </p>
      )}

      {g.state === 'asking' && g.question && (
        <div className={styles.question} data-testid="generation-question">
          <p className={styles.questionText}>{g.question.text}</p>
          {g.question.options.length > 0 && (
            <div className={styles.options}>
              {g.question.options.map((o) => (
                <Button key={o} disabled={busy} onClick={() => void sendAnswer(o, false)}>
                  {o}
                </Button>
              ))}
            </div>
          )}
          <form
            className={styles.reply}
            onSubmit={(e) => {
              e.preventDefault();
              void sendAnswer(answer, true);
            }}
          >
            <label className={styles.field}>
              <span>Answer</span>
              <textarea rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} />
            </label>
            <Button type="submit" variant="primary" disabled={busy || !answer.trim()}>
              Send answer
            </Button>
          </form>
        </div>
      )}

      {g.state === 'failed' && (
        <>
          {g.errors && g.errors.length > 0 && (
            <ul className={styles.errors} aria-label="Errors">
              {g.errors.map((e, i) => (
                <li key={i}>{errorLine(e)}</li>
              ))}
            </ul>
          )}
          {g.failureReason && (
            <p className={styles.failure} data-testid="generation-failure">
              {g.failureReason}
            </p>
          )}
        </>
      )}

      {g.state === 'ready' && (
        <form
          className={styles.reply}
          onSubmit={(e) => {
            e.preventDefault();
            void sendChanges();
          }}
        >
          <label className={styles.field}>
            <span>Changes</span>
            <textarea rows={2} value={changes} onChange={(e) => setChanges(e.target.value)} maxLength={4000} />
          </label>
          <Button type="submit" disabled={busy || !changes.trim()}>
            Request changes
          </Button>
        </form>
      )}

      {(g.state === 'ready' || g.state === 'failed') && (
        <div className={styles.actions}>
          {g.state === 'ready' && (
            <a className={styles.primaryLink} href={editorHref(g.id)}>
              Open in editor
            </a>
          )}
          {g.state === 'failed' && g.hasDraft && (
            <a className={styles.link} href={editorHref(g.id)}>
              Open in editor anyway
            </a>
          )}
          <Button variant="danger" disabled={busy} onClick={onDiscard}>
            Discard
          </Button>
        </div>
      )}

      {action.error && (
        <p className={styles.error} role="alert">
          {action.error}
        </p>
      )}
    </article>
  );
}
