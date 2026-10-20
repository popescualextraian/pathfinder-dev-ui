import { useRef, type ReactNode } from 'react';
import type { Lane, WorkflowDefinition, WorkflowErrorLocation } from '../api/models';
import {
  PLACEHOLDERS,
  addSession,
  errorAt,
  forkOptions,
  isMainSession,
  moveSession,
  removeSession,
  setDoneStage,
  updateSession,
  updateStep,
} from '../state/workflow-draft';
import { Button } from './Button';
import styles from './WorkflowInspector.module.css';

interface Props {
  draft: WorkflowDefinition;
  /** Selected step; null edits the workflow itself. */
  step: number | null;
  lanes: Lane[];
  error: (WorkflowErrorLocation & { message: string }) | null;
  readOnly: boolean;
  onChange: (change: (draft: WorkflowDefinition) => WorkflowDefinition) => void;
}

/** An error on doneStage names the field and no step. */
export const doneStageError = (error: (WorkflowErrorLocation & { message: string }) | null): boolean =>
  errorAt(error, { field: 'doneStage' }) && error?.stepId === undefined && error?.stepIndex === undefined;

const NO_MOVE = "— don't move —";

function LaneSelect({ id, label, value, lanes, disabled, invalid, onChange }: {
  id: string; label: string; value: string | undefined; lanes: Lane[]; disabled: boolean; invalid: boolean;
  onChange: (lane: string) => void;
}) {
  const unknown = value && !lanes.some((l) => l.id === value);
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value ?? ''} disabled={disabled} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)}>
        <option value="">{NO_MOVE}</option>
        {unknown && <option value={value}>{value} (unknown lane)</option>}
        {lanes.map((l) => (
          <option key={l.id} value={l.id}>
            {l.title}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A textarea with the placeholders as chips that insert at the cursor. */
function PromptField({ label, value, disabled, invalid, rows, onChange }: {
  label: string; value: string; disabled: boolean; invalid: boolean; rows: number; onChange: (value: string) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (name: string) => {
    const el = area.current;
    const text = `{{${name}}}`;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    onChange(value.slice(0, at) + text + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  };
  return (
    <div className={styles.field}>
      <label>
        <span>{label}</span>
        <textarea
          ref={area}
          rows={rows}
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {!disabled && (
        <div className={styles.chips} role="group" aria-label={`Placeholders for ${label}`}>
          {PLACEHOLDERS.map((p) => (
            <button key={p} type="button" className={styles.chip} onClick={() => insert(p)}>
              {`{{${p}}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function WorkflowInspector({ draft, step: index, lanes, error, readOnly, onChange }: Props) {
  if (index === null || !draft.steps[index]) {
    return (
      <aside className={styles.inspector} aria-label="Inspector">
        <h2>Workflow</h2>
        <LaneSelect
          id="workflow-done-stage"
          label="When the workflow ends, move the item to"
          value={draft.doneStage}
          lanes={lanes}
          disabled={readOnly}
          invalid={doneStageError(error)}
          onChange={(lane) => onChange((d) => setDoneStage(d, lane))}
        />
        <p className={styles.hint}>Select a step in the flow to edit it.</p>
      </aside>
    );
  }
  const step = draft.steps[index];
  const bad = (field: string, session?: string, sessionIndex?: number) =>
    (errorAt(error, { stepId: step.id, field, ...(session !== undefined && { session }) }) ||
      errorAt(error, { stepIndex: index, field, ...(sessionIndex !== undefined && { sessionIndex }) })) &&
    (session !== undefined || (error?.session === undefined && error?.sessionIndex === undefined));
  const patch = (p: Parameters<typeof updateStep>[2]) => onChange((d) => updateStep(d, index, p));
  const requires = step.requires ?? [];

  return (
    <aside className={styles.inspector} aria-label="Inspector">
      <h2>Step {index + 1}</h2>
      <Field label="Step title">
        <input value={step.title} disabled={readOnly} aria-invalid={bad('title') || undefined} onChange={(e) => patch({ title: e.target.value })} />
      </Field>
      <Field label="Step id">
        <input value={step.id} disabled={readOnly} aria-invalid={bad('id') || undefined} onChange={(e) => patch({ id: e.target.value })} />
      </Field>
      <Field label="Gate">
        <select value={step.gate} disabled={readOnly} aria-invalid={bad('gate') || undefined} onChange={(e) => patch({ gate: e.target.value as 'human' | 'auto' })}>
          <option value="human">You approve (✋)</option>
          <option value="auto">Automatic (⚡)</option>
        </select>
      </Field>
      <LaneSelect
        id="step-stage"
        label="When this step starts, move the item to"
        value={step.stage}
        lanes={lanes}
        disabled={readOnly}
        invalid={bad('stage')}
        onChange={(lane) => patch({ stage: lane })}
      />

      <fieldset className={styles.group}>
        <legend>Required files</legend>
        {requires.map((r, k) => (
          <div key={k} className={styles.inline}>
            <input
              aria-label={`Required file ${k + 1}`}
              value={r}
              disabled={readOnly}
              aria-invalid={bad('requires') || undefined}
              onChange={(e) => patch({ requires: requires.map((x, i) => (i === k ? e.target.value : x)) })}
            />
            {!readOnly && (
              <Button aria-label={`Remove required file ${k + 1}`} onClick={() => patch({ requires: requires.filter((_, i) => i !== k) })}>
                ×
              </Button>
            )}
          </div>
        ))}
        {!readOnly && <Button onClick={() => patch({ requires: [...requires, ''] })}>+ required file</Button>}
      </fieldset>

      <PromptField
        label="Exit prompt"
        value={step.exitPrompt ?? ''}
        rows={3}
        disabled={readOnly}
        invalid={bad('exitPrompt')}
        onChange={(v) => patch({ exitPrompt: v })}
      />

      <h3>Sessions</h3>
      {step.sessions.map((s, j) => {
        const n = j + 1;
        const main = isMainSession(index, j);
        const options = forkOptions(draft, index, j);
        const sbad = (field: string) => bad(field, s.name, j);
        return (
          <fieldset key={j} className={styles.group} data-testid={`session-${n}`}>
            <legend>Session {n}</legend>
            <Field label={`Session ${n} name`}>
              <input
                value={s.name}
                disabled={readOnly || main}
                title={main ? 'The first session is always main' : undefined}
                aria-invalid={sbad('name') || undefined}
                onChange={(e) => onChange((d) => updateSession(d, index, j, { name: e.target.value }))}
              />
            </Field>
            <PromptField
              label={`Session ${n} prompt`}
              value={s.prompt}
              rows={6}
              disabled={readOnly}
              invalid={sbad('prompt')}
              onChange={(v) => onChange((d) => updateSession(d, index, j, { prompt: v }))}
            />
            <Field label={`Session ${n} starts as a copy of`}>
              <select
                value={s.fork ?? ''}
                disabled={readOnly}
                aria-invalid={sbad('fork') || undefined}
                onChange={(e) => onChange((d) => updateSession(d, index, j, { fork: e.target.value }))}
              >
                <option value="">— fresh session —</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Session ${n} model`}>
              <input
                value={s.model ?? ''}
                disabled={readOnly}
                aria-invalid={sbad('model') || undefined}
                onChange={(e) => onChange((d) => updateSession(d, index, j, { model: e.target.value }))}
              />
            </Field>
            {!readOnly && (
              <div className={styles.inline}>
                <Button aria-label={`Move session ${n} up`} disabled={j === 0 || isMainSession(index, j - 1)} onClick={() => onChange((d) => moveSession(d, index, j, -1))}>
                  ↑
                </Button>
                <Button aria-label={`Move session ${n} down`} disabled={main || j === step.sessions.length - 1} onClick={() => onChange((d) => moveSession(d, index, j, 1))}>
                  ↓
                </Button>
                <Button aria-label={`Remove session ${n}`} disabled={main} onClick={() => onChange((d) => removeSession(d, index, j))}>
                  Remove
                </Button>
              </div>
            )}
          </fieldset>
        );
      })}
      {!readOnly && <Button onClick={() => onChange((d) => addSession(d, index))}>+ session</Button>}
    </aside>
  );
}
