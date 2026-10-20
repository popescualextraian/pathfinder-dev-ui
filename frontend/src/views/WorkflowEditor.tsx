import { useState } from 'react';
import type { Lane } from '../api/models';
import type { WorkflowEditor as Editor } from '../state/use-workflow-editor';
import { addStep, errorAt, moveStep, removeStep, toggleGate } from '../state/workflow-draft';
import { Button } from './Button';
import { ConfirmDialog } from './Dialog';
import { WorkflowInspector } from './WorkflowInspector';
import styles from './WorkflowEditor.module.css';

interface Props {
  editor: Editor;
  lanes: Lane[];
  /** Leave the editor (after a confirmed Cancel or when read-only "Close"). */
  onClose: () => void;
  /** Saved: the id the file has now. */
  onSaved: (id: string) => void;
}

export function WorkflowEditor({ editor, lanes, onClose, onSaved }: Props) {
  const { draft, validationError: error, readOnly } = editor;
  const [selected, setSelected] = useState<number | null>(0);
  const [asking, setAsking] = useState<'cancel' | 'delete-step' | null>(null);
  const laneTitle = (id: string) => lanes.find((l) => l.id === id)?.title ?? id;
  const step = selected !== null ? draft.steps[selected] : undefined;
  const sel = step ? selected : null;

  if (editor.loading) return <p className={styles.state}>Loading…</p>;
  if (editor.loadError) {
    return (
      <div className={styles.state} role="alert">
        <p>{editor.loadError}</p>
        <Button onClick={onClose}>Back to the list</Button>
      </div>
    );
  }

  const save = async () => {
    if (await editor.save()) onSaved(editor.id);
  };
  const overwrite = async () => {
    if (await editor.overwrite()) onSaved(editor.id);
  };
  const cancel = () => (editor.dirty && !readOnly ? setAsking('cancel') : onClose());
  const change = editor.setDraft;
  const lastIndex = draft.steps.length - 1;

  return (
    <div className={styles.editor}>
      <header className={styles.header}>
        <label className={styles.title}>
          <span>Workflow title</span>
          <input
            value={draft.title}
            disabled={readOnly}
            aria-invalid={(errorAt(error, { field: 'title' }) && error?.stepId === undefined) || undefined}
            onChange={(e) => editor.setTitle(e.target.value)}
          />
        </label>
        <label className={styles.idField}>
          <span>Workflow id</span>
          <input value={editor.id} disabled={!editor.isNew || readOnly} onChange={(e) => editor.setId(e.target.value)} />
        </label>
        <div className={styles.buttons}>
          {!readOnly && (
            <Button variant="primary" disabled={!editor.canSave} onClick={() => void save()}>
              {editor.saving ? 'Saving…' : 'Save'}
            </Button>
          )}
          <Button onClick={cancel}>{readOnly ? 'Close' : 'Cancel'}</Button>
        </div>
      </header>

      {readOnly && (
        <p className={styles.notice} role="status">
          The workflows folder is read-only: this definition cannot be changed.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert" data-testid="validation-error">
          {error.message}
        </p>
      )}
      {editor.saveError && (
        <p className={styles.error} role="alert">
          {editor.saveError}
        </p>
      )}
      {editor.conflict && (
        <div className={styles.conflict} role="alert" data-testid="conflict">
          <p>{editor.isNew ? 'A workflow with this id already exists.' : 'This workflow was changed by someone else since you opened it.'} ({editor.conflict})</p>
          {!editor.isNew && (
            <div className={styles.buttons}>
              <Button onClick={() => void editor.reload()}>Reload their version</Button>
              <Button variant="danger" onClick={() => void overwrite()}>
                Keep mine (overwrite)
              </Button>
            </div>
          )}
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.flowPane}>
          <ol className={styles.flow} aria-label="Steps">
            {draft.steps.map((s, i) => {
              const bad = errorAt(error, { stepId: s.id });
              const gate = s.gate === 'human';
              return (
                <li key={i} className={styles.item}>
                  <button
                    type="button"
                    className={`${styles.box} ${i === sel ? styles.selected : ''} ${bad ? styles.bad : ''}`}
                    aria-pressed={i === sel}
                    aria-invalid={bad || undefined}
                    aria-label={`Step ${i + 1}${s.title ? `: ${s.title}` : ''}`}
                    data-testid={`step-box-${i + 1}`}
                    data-error={bad ? 'true' : undefined}
                    onClick={() => setSelected(i)}
                  >
                    <span className={styles.boxTitle}>{bad && '⚠ '}{s.title || '(untitled)'}</span>
                    {s.stage ? (
                      <span className={styles.lane}>→ {laneTitle(s.stage)}</span>
                    ) : (
                      <span className={styles.noLane}>no lane move</span>
                    )}
                    {s.sessions.map((x) => (
                      <span key={x.name} className={styles.session}>
                        {x.name}
                        {x.fork && <span className={styles.fork}> ⑂ fork</span>}
                        {x.model && <span className={styles.model}> {x.model}</span>}
                      </span>
                    ))}
                    {s.requires && s.requires.length > 0 && <span className={styles.requires}>◈ requires files</span>}
                  </button>
                  <button
                    type="button"
                    className={styles.gate}
                    disabled={readOnly}
                    data-gate={s.gate}
                    data-testid={`gate-${i + 1}`}
                    aria-label={`Gate after step ${i + 1}: ${gate ? 'you approve' : 'automatic'}`}
                    title={gate ? 'You approve before the next step (click to make it automatic)' : 'Starts the next step automatically (click to require approval)'}
                    onClick={() => change((d) => toggleGate(d, i))}
                  >
                    {gate ? '✋' : '⚡'}
                  </button>
                </li>
              );
            })}
            <li className={styles.item}>
              <button
                type="button"
                className={`${styles.box} ${styles.end} ${sel === null ? styles.selected : ''}`}
                aria-pressed={sel === null}
                aria-label="End of the workflow"
                data-testid="end-box"
                onClick={() => setSelected(null)}
              >
                <span className={styles.boxTitle}>
                  when done → {draft.doneStage ? laneTitle(draft.doneStage) : "don't move"}
                </span>
              </button>
            </li>
            {!readOnly && (
              <li className={styles.item}>
                <Button
                  onClick={() => {
                    change((d) => addStep(d));
                    setSelected(draft.steps.length);
                  }}
                >
                  + step
                </Button>
              </li>
            )}
          </ol>

          {step && sel !== null && !readOnly && (
            <div className={styles.toolbar} role="toolbar" aria-label={`Step ${sel + 1} actions`}>
              <Button
                aria-label="Move step left"
                disabled={sel === 0}
                onClick={() => {
                  change((d) => moveStep(d, sel, -1));
                  setSelected(sel - 1);
                }}
              >
                ←
              </Button>
              <Button
                aria-label="Move step right"
                disabled={sel === lastIndex}
                onClick={() => {
                  change((d) => moveStep(d, sel, 1));
                  setSelected(sel + 1);
                }}
              >
                →
              </Button>
              <Button variant="danger" aria-label="Delete step" onClick={() => setAsking('delete-step')}>
                Delete step
              </Button>
            </div>
          )}
        </div>
        <WorkflowInspector draft={draft} step={sel} lanes={lanes} error={error} readOnly={readOnly} onChange={change} />
      </div>

      {asking === 'cancel' && (
        <ConfirmDialog
          title="Discard your changes?"
          message="The workflow has changes that are not saved."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          danger
          onConfirm={() => {
            setAsking(null);
            onClose();
          }}
          onCancel={() => setAsking(null)}
        />
      )}
      {asking === 'delete-step' && step && sel !== null && (
        <ConfirmDialog
          title={`Delete step ${sel + 1}${step.title ? ` "${step.title}"` : ''}?`}
          confirmLabel="Delete step"
          danger
          onConfirm={() => {
            setAsking(null);
            change((d) => removeStep(d, sel));
            setSelected(null);
          }}
          onCancel={() => setAsking(null)}
        />
      )}
    </div>
  );
}
