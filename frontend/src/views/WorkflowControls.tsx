import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { BacklogItem, WorkflowSummary } from '../api/models';
import { Button } from './Button';
import { ConfirmDialog, Dialog, dialogStyles } from './Dialog';
import { NewTaskDialog } from './NewTaskDialog';
import { WorkflowRunLine } from './WorkflowRunLine';
import { isActiveRun, isTaskRun, kickoffPrompt, stepStates, type WorkflowBoard } from './workflow-run-view';
import styles from './Workflow.module.css';

interface Props {
  item: BacklogItem;
  workflows: WorkflowBoard;
  /** The detail panel also lists the run's steps. */
  showSteps?: boolean;
}

/**
 * A work item's run (workflow or plain task, if any), the steps (detail), and, when none is active, starting a plain
 * task (always) or a workflow (when there are definitions).
 */
export function WorkflowControls({ item, workflows, showSteps }: Props) {
  const itemId = item.id;
  const run = workflows.runsByItem.get(itemId);
  const { pending, error } = workflows.actionState(itemId);
  const free = !run || !isActiveRun(run);
  const canStart = free && workflows.definitions.length > 0;

  return (
    <div className={styles.controls} data-testid="workflow-controls">
      {run && <WorkflowRunLine run={run} pending={pending} onAdvance={workflows.advance} onStop={workflows.stop} />}
      {run && showSteps && !isTaskRun(run) && (
        <ol className={styles.steps} aria-label="Workflow steps">
          {stepStates(run).map(({ step, state }) => (
            <li key={step.id} data-state={state} className={styles[`step-${state}`]}>
              {step.title} · {state}
            </li>
          ))}
        </ol>
      )}
      {free && <TaskStart item={item} workflows={workflows} pending={pending} />}
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

/** "▶ Task" → the New task dialog, prefilled for the item → a plain task linked to it, then its task screen. */
function TaskStart({ item, workflows, pending }: { item: BacklogItem; workflows: WorkflowBoard; pending: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className={styles.small} aria-label={`Start task on #${item.id}`} disabled={pending} onClick={() => setOpen(true)}>
        ▶ Task
      </Button>
      {/* Portal: not inside the draggable card (text selection in the fields) or a scrolling panel. */}
      {open &&
        createPortal(
        <NewTaskDialog
          heading={`New task on #${item.id}`}
          initial={{ title: `#${item.id} ${item.title}`, prompt: kickoffPrompt(item) }}
          repositories={workflows.repositories}
          submit={async (input) => {
            const result = await workflows.startTask(item.id, input);
            return result.ok ? result.value.taskId : null;
          }}
          submitState={workflows.actionState(item.id)}
          onClose={() => setOpen(false)}
          onStarted={(taskId) => {
            setOpen(false);
            workflows.onTaskStarted(taskId);
          }}
        />,
        document.body,
      )}
    </>
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
