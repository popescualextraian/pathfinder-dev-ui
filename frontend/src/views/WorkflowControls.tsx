import { useState } from 'react';
import type { WorkflowSummary } from '../api/models';
import { Button } from './Button';
import { ConfirmDialog, Dialog, dialogStyles } from './Dialog';
import { WorkflowRunLine } from './WorkflowRunLine';
import { isActiveRun, stepStates, type WorkflowBoard } from './workflow-run-view';
import styles from './Workflow.module.css';

interface Props {
  itemId: string;
  workflows: WorkflowBoard;
  /** The detail panel also lists the run's steps. */
  showSteps?: boolean;
}

/** A work item's workflow: its run (if any), the steps (detail), and starting a new one when none is active. */
export function WorkflowControls({ itemId, workflows, showSteps }: Props) {
  const run = workflows.runsByItem.get(itemId);
  const { pending, error } = workflows.actionState(itemId);
  const canStart = (!run || !isActiveRun(run)) && workflows.definitions.length > 0;

  return (
    <div className={styles.controls} data-testid="workflow-controls">
      {run && <WorkflowRunLine run={run} pending={pending} onAdvance={workflows.advance} onStop={workflows.stop} />}
      {run && showSteps && (
        <ol className={styles.steps} aria-label="Workflow steps">
          {stepStates(run).map(({ step, state }) => (
            <li key={step.id} data-state={state} className={styles[`step-${state}`]}>
              {step.title} · {state}
            </li>
          ))}
        </ol>
      )}
      {canStart && (
        <WorkflowStart itemId={itemId} definitions={workflows.definitions} pending={pending} onStart={workflows.start} />
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

interface StartProps {
  itemId: string;
  definitions: WorkflowSummary[];
  pending: boolean;
  onStart: (itemId: string, workflowId: string) => Promise<unknown>;
}

/** "▶ Workflow" → picker (skipped with one definition) → confirm → start. */
function WorkflowStart({ itemId, definitions, pending, onStart }: StartProps) {
  // 'pick' shows the picker; a definition asks for confirmation.
  const [step, setStep] = useState<null | 'pick' | WorkflowSummary>(null);
  const close = () => setStep(null);

  return (
    <>
      <Button
        className={styles.small}
        aria-label={`Start workflow on #${itemId}`}
        disabled={pending}
        onClick={() => setStep(definitions.length === 1 ? definitions[0] : 'pick')}
      >
        ▶ Workflow
      </Button>
      {step === 'pick' && (
        <Dialog title={`Choose a workflow for #${itemId}`} onClose={close}>
          <div className={dialogStyles.choices}>
            {definitions.map((d) => (
              <Button key={d.id} onClick={() => setStep(d)}>
                {d.title}
              </Button>
            ))}
          </div>
          <div className={dialogStyles.actions}>
            <Button onClick={close}>Cancel</Button>
          </div>
        </Dialog>
      )}
      {step && step !== 'pick' && (
        <ConfirmDialog
          title={`Start ${step.title} on #${itemId}?`}
          message={`Steps: ${step.steps.map((s) => s.title).join(' → ')}`}
          confirmLabel="Start"
          onCancel={close}
          onConfirm={() => {
            close();
            void onStart(itemId, step.id);
          }}
        />
      )}
    </>
  );
}
