import { useState } from 'react';
import type { WorkflowRun } from '../api/models';
import { Button } from './Button';
import { ConfirmDialog } from './Dialog';
import {
  awaitingApproval,
  isActiveRun,
  isBlocked,
  isTaskRun,
  needsAttention,
  nextStep,
  openStepHref,
  STATE_LABEL,
  stepLabel,
} from './workflow-run-view';
import { taskHref } from '../state/use-route';
import styles from './Workflow.module.css';

interface Props {
  run: WorkflowRun;
  pending: boolean;
  onAdvance: (runId: string, force?: boolean) => Promise<unknown>;
  onStop: (runId: string) => Promise<unknown>;
}

/**
 * One run on a card or in the detail: workflow, step, state, and the actions an active run offers. A plain task run
 * (kind `task`) shows "Task", its state, Open task and ■ Stop only.
 */
export function WorkflowRunLine({ run, pending, onAdvance, onStop }: Props) {
  const [stopping, setStopping] = useState(false);
  const plain = isTaskRun(run);
  const active = isActiveRun(run);
  const attention = needsAttention(run);
  const label = STATE_LABEL[run.state];
  const next = nextStep(run);
  const note = run.state === 'failed' ? run.failureReason : active ? run.warning : undefined;

  return (
    <div
      className={`${styles.line} ${attention ? styles.attention : ''}`}
      data-testid="workflow-run-line"
      data-state={run.state}
      data-attention={attention ? 'true' : undefined}
      aria-label={plain ? `Task: ${label}` : `Workflow ${run.definition.title}: ${label}`}
      role="group"
    >
      <div className={styles.summary}>
        <span className={styles.workflow} data-testid="workflow-title">
          {plain ? 'Task' : run.definition.title}
        </span>
        {!plain && (
          <span className={styles.step} data-testid="workflow-step">
            {stepLabel(run)}
          </span>
        )}
        <span className={`${styles.state} ${styles[run.state] ?? ''}`} data-testid="workflow-state">
          {label}
        </span>
      </div>
      {note && (
        <p className={styles.warning} data-testid="workflow-warning">
          {note}
        </p>
      )}
      {active && plain && (
        <div className={styles.buttons}>
          <a className={styles.link} href={taskHref(run.taskId)}>
            Open task
          </a>
          <Button className={styles.small} disabled={pending} onClick={() => setStopping(true)}>
            ■ Stop
          </Button>
        </div>
      )}
      {active && !plain && (
        <div className={styles.buttons}>
          <a className={styles.link} href={openStepHref(run)}>
            Open step
          </a>
          {awaitingApproval(run) && (
            <Button variant="primary" className={styles.small} disabled={pending} onClick={() => void onAdvance(run.id)}>
              {next ? `Continue → ${next.title}` : 'Finish'}
            </Button>
          )}
          {isBlocked(run) && (
            <Button variant="primary" className={styles.small} disabled={pending} onClick={() => void onAdvance(run.id, true)}>
              Start anyway
            </Button>
          )}
          <Button className={styles.small} disabled={pending} onClick={() => setStopping(true)}>
            Stop workflow
          </Button>
        </div>
      )}
      {stopping && (
        <ConfirmDialog
          title={plain ? `Stop the task link on #${run.itemId}?` : `Stop ${run.definition.title} on #${run.itemId}?`}
          message={
            plain
              ? 'The task is left as it is; the item is no longer linked to it.'
              : 'The task is left as it is; the workflow does not go on.'
          }
          confirmLabel="Yes, stop"
          cancelLabel="Keep running"
          danger
          onCancel={() => setStopping(false)}
          onConfirm={() => {
            setStopping(false);
            void onStop(run.id);
          }}
        />
      )}
    </div>
  );
}
