import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Lane, WorkflowDefinition, WorkflowErrorLocation } from '../api/models';
import {
  PLACEHOLDERS,
  conversationChoices,
  conversationOf,
  errorAt,
  isTaskPlaceholder,
  setConversation,
  setDoneStage,
  updateStep,
  type Conversation,
} from '../state/workflow-draft';
import { Button } from './Button';
import { Dialog } from './Dialog';
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
const PROMPT_ROWS = 6;
const EXIT_PROMPT_ROWS = 3;

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

type TextElement = HTMLTextAreaElement | HTMLInputElement;

/** Inserts `{{name}}` over the selection of `el` (at the end without one); the caret goes after it. */
function insertPlaceholder(el: TextElement | null, value: string, name: string, onChange: (value: string) => void) {
  const text = `{{${name}}}`;
  const at = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? at;
  onChange(value.slice(0, at) + text + value.slice(end));
  requestAnimationFrame(() => {
    el?.focus();
    el?.setSelectionRange(at + text.length, at + text.length);
  });
}

/** The placeholder chips; `noTask` disables the `task.*` ones (the first step's prompt runs before the task exists). */
function ChipRow({ noTask, onInsert }: { noTask: boolean; onInsert: (name: string) => void }) {
  return (
    <div className={styles.chips} role="group" aria-label="Insert placeholder">
      {PLACEHOLDERS.map((p) => {
        const off = noTask && isTaskPlaceholder(p);
        return (
          <button
            key={p}
            type="button"
            className={styles.chip}
            disabled={off}
            title={off ? 'The first prompt runs before the task exists' : undefined}
            // keep the focus (and the caret) in the field the placeholder goes into
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(p)}
          >
            {`{{${p}}}`}
          </button>
        );
      })}
    </div>
  );
}

/** A textarea that grows with its text (at least `rows` lines). */
function GrowingTextarea({ id, area, rows, value, readOnly, invalid, onChange, onFocus }: {
  id: string; area: RefObject<HTMLTextAreaElement | null>; rows: number; value: string; readOnly: boolean; invalid: boolean;
  onChange: (value: string) => void; onFocus: () => void;
}) {
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight + 2}px`;
  }, [area, value]);
  return (
    <textarea
      id={id}
      ref={area}
      rows={rows}
      value={value}
      readOnly={readOnly}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
    />
  );
}

/** A prompt field with an "expand" button that opens it in a large dialog. */
function PromptField({ label, value, rows, readOnly, invalid, noTask, area, onFocus, onChange }: {
  label: string; value: string; rows: number; readOnly: boolean; invalid: boolean; noTask: boolean;
  area: RefObject<HTMLTextAreaElement | null>; onFocus: () => void; onChange: (value: string) => void;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id}>{label}</label>
        <button type="button" className={styles.expand} aria-label={`Expand ${label}`} title="Open in a large editor" onClick={() => setExpanded(true)}>
          ⤢
        </button>
      </div>
      <GrowingTextarea id={id} area={area} rows={rows} value={value} readOnly={readOnly} invalid={invalid} onChange={onChange} onFocus={onFocus} />
      {expanded && (
        <ExpandedPrompt label={label} value={value} readOnly={readOnly} noTask={noTask} onChange={onChange} onClose={() => setExpanded(false)} />
      )}
    </div>
  );
}

function ExpandedPrompt({ label, value, readOnly, noTask, onChange, onClose }: {
  label: string; value: string; readOnly: boolean; noTask: boolean; onChange: (value: string) => void; onClose: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  return (
    <Dialog title={label} onClose={onClose} wide initialFocus="textarea">
      {!readOnly && <ChipRow noTask={noTask} onInsert={(name) => insertPlaceholder(area.current, value, name, onChange)} />}
      <textarea
        ref={area}
        className={styles.bigText}
        aria-label={label}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className={styles.dialogActions}>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}

const conversationValue = (c: Conversation) => (c.kind === 'new' ? '' : `${c.kind}:${c.step}`);
function parseConversation(value: string): Conversation {
  const colon = value.indexOf(':');
  const kind = value.slice(0, colon);
  const step = value.slice(colon + 1);
  return kind === 'continue' || kind === 'fork' ? { kind, step } : { kind: 'new' };
}

/** The field the placeholder chips insert into: the last focused one. */
type Target = 'prompt' | 'exitPrompt' | { requires: number };

export function WorkflowInspector({ draft, step: index, lanes, error, readOnly, onChange }: Props) {
  const promptArea = useRef<HTMLTextAreaElement>(null);
  const exitArea = useRef<HTMLTextAreaElement>(null);
  const fileInputs = useRef(new Map<number, HTMLInputElement>());
  const [target, setTarget] = useState<Target>('prompt');
  useEffect(() => setTarget('prompt'), [index]);

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
  const first = index === 0;
  const bad = (...fields: string[]) =>
    fields.some((field) => errorAt(error, { stepId: step.id, field }) || errorAt(error, { stepIndex: index, field }));
  const patch = (p: Parameters<typeof updateStep>[2]) => onChange((d) => updateStep(d, index, p));
  const requires = step.requires ?? [];
  const conversation = conversationOf(step);
  const choices = conversationChoices(draft, index);
  const choiceTitle = (title: string, i: number) => title || `Step ${i + 1}`;

  const insert = (name: string) => {
    if (target === 'prompt') insertPlaceholder(promptArea.current, step.prompt, name, (v) => patch({ prompt: v }));
    else if (target === 'exitPrompt') insertPlaceholder(exitArea.current, step.exitPrompt ?? '', name, (v) => patch({ exitPrompt: v }));
    else {
      const k = target.requires;
      insertPlaceholder(fileInputs.current.get(k) ?? null, requires[k] ?? '', name, (v) =>
        patch({ requires: requires.map((x, i) => (i === k ? v : x)) }),
      );
    }
  };

  return (
    <aside className={styles.inspector} aria-label="Inspector">
      <h2>Step {index + 1}</h2>
      {!readOnly && <ChipRow noTask={first && target === 'prompt'} onInsert={insert} />}

      <Field label="Step title">
        <input value={step.title} disabled={readOnly} aria-invalid={bad('title', 'id') || undefined} onChange={(e) => patch({ title: e.target.value })} />
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
        <legend>Start</legend>
        <div className={styles.field}>
          <span>Required files</span>
          {requires.map((r, k) => (
            <div key={k} className={styles.inline}>
              <input
                ref={(el) => {
                  if (el) fileInputs.current.set(k, el);
                  else fileInputs.current.delete(k);
                }}
                aria-label={`Required file ${k + 1}`}
                value={r}
                disabled={readOnly}
                aria-invalid={bad('requires') || undefined}
                onFocus={() => setTarget({ requires: k })}
                onChange={(e) => patch({ requires: requires.map((x, i) => (i === k ? e.target.value : x)) })}
              />
              {!readOnly && (
                <Button aria-label={`Remove required file ${k + 1}`} onClick={() => patch({ requires: requires.filter((_, i) => i !== k) })}>
                  ×
                </Button>
              )}
            </div>
          ))}
          {!readOnly && (
            <Button className={styles.add} onClick={() => patch({ requires: [...requires, ''] })}>
              + required file
            </Button>
          )}
        </div>
        {!first && (
          <Field label="Conversation">
            <select
              value={conversationValue(conversation)}
              disabled={readOnly}
              aria-invalid={bad('continue', 'fork') || undefined}
              onChange={(e) => onChange((d) => setConversation(d, index, parseConversation(e.target.value)))}
            >
              <option value="">New conversation</option>
              {choices.map((c, i) => (
                <option key={`c-${c.id}`} value={`continue:${c.id}`}>
                  Continue: {choiceTitle(c.title, i)}
                </option>
              ))}
              {choices.map((c, i) => (
                <option key={`f-${c.id}`} value={`fork:${c.id}`}>
                  Copy of: {choiceTitle(c.title, i)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <PromptField
          label="Prompt"
          value={step.prompt}
          rows={PROMPT_ROWS}
          readOnly={readOnly}
          invalid={bad('prompt')}
          noTask={first}
          area={promptArea}
          onFocus={() => setTarget('prompt')}
          onChange={(v) => patch({ prompt: v })}
        />
      </fieldset>

      <fieldset className={styles.group}>
        <legend>End</legend>
        <PromptField
          label="Exit prompt"
          value={step.exitPrompt ?? ''}
          rows={EXIT_PROMPT_ROWS}
          readOnly={readOnly}
          invalid={bad('exitPrompt')}
          noTask={false}
          area={exitArea}
          onFocus={() => setTarget('exitPrompt')}
          onChange={(v) => patch({ exitPrompt: v })}
        />
        <Field label="Then">
          <select value={step.gate} disabled={readOnly} aria-invalid={bad('gate') || undefined} onChange={(e) => patch({ gate: e.target.value as 'human' | 'auto' })}>
            <option value="human">wait for my approval ✋</option>
            <option value="auto">go on automatically ⚡</option>
          </select>
        </Field>
      </fieldset>

      {conversation.kind !== 'continue' && (
        <details className={styles.advanced} open={bad('model') || undefined}>
          <summary>Advanced</summary>
          <Field label="Model">
            <input
              value={step.model ?? ''}
              disabled={readOnly}
              placeholder="the task's model"
              aria-invalid={bad('model') || undefined}
              onChange={(e) => patch({ model: e.target.value })}
            />
          </Field>
        </details>
      )}
    </aside>
  );
}
