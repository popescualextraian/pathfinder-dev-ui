import { useState } from 'react';
import type { Task } from '../api/models';
import { useTaskActions } from '../state/use-task-actions';
import { Button } from './Button';
import { FullRun } from './FullRun';
import { LastResponse } from './LastResponse';
import { PromptBlock } from './PromptBlock';
import { QuestionCard } from './QuestionCard';
import { ReplyBox } from './ReplyBox';
import { StatePill } from './StatePill';
import styles from './TaskView.module.css';

interface Props {
  task: Task | null;
  loading?: boolean;
  error?: string | null;
  /** Called after the task was deleted so the selection can clear. */
  onDeleted: () => void;
}

export function TaskView({ task, loading, error, onDeleted }: Props) {
  if (!task) {
    return (
      <p className={styles.empty} role={error ? 'alert' : undefined}>
        {error ?? (loading ? 'Loading…' : 'Select a task')}
      </p>
    );
  }
  return <TaskDetail key={task.id} task={task} onDeleted={onDeleted} />;
}

function TaskDetail({ task, onDeleted }: { task: Task; onDeleted: () => void }) {
  const actions = useTaskActions(task.id);
  const [showRun, setShowRun] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const done = task.closed || task.state === 'stopped';
  const closed = task.closed;
  const headerError = actions.cancel.error ?? actions.close.error ?? actions.remove.error;

  const remove = async () => {
    if ((await actions.remove.run()).ok) onDeleted();
  };

  return (
    <article className={styles.view} aria-label={task.title}>
      <header className={styles.header}>
        <h2 className={styles.title}>{task.title}</h2>
        <StatePill state={task.state} section={task.section} label={closed ? 'closed' : undefined} />
        <div className={styles.actions}>
          {task.section === 'working' ? (
            <Button disabled={actions.cancel.pending} onClick={() => void actions.cancel.run()}>
              Cancel turn
            </Button>
          ) : (
            !closed && (
              <Button disabled={actions.close.pending} onClick={() => void actions.close.run()}>
                Close task
              </Button>
            )
          )}
          {done &&
            (confirming ? (
              <span className={styles.confirm}>
                Delete this task for good?
                <Button variant="danger" disabled={actions.remove.pending} onClick={() => void remove()}>
                  Yes, delete
                </Button>
                <Button onClick={() => setConfirming(false)}>Keep</Button>
              </span>
            ) : (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Delete forever
              </Button>
            ))}
        </div>
      </header>
      {headerError && (
        <p role="alert" className={styles.error}>
          {headerError}
        </p>
      )}
      <PromptBlock prompt={task.prompt} />
      <LastResponse task={task} />
      {task.questions.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          pending={actions.answer.pending}
          error={actions.answer.error}
          onAnswer={(text, question) => void actions.answer.run(text, question)}
        />
      ))}
      <button type="button" className={styles.runLink} onClick={() => setShowRun(!showRun)} aria-expanded={showRun}>
        {showRun ? 'Hide full run ▾' : 'View full run ▸'}
      </button>
      {showRun && <FullRun taskId={task.id} />}
      <ReplyBox
        disabled={done}
        pending={actions.prompt.pending}
        error={actions.prompt.error}
        onSend={async (text) => (await actions.prompt.run(text)).ok}
      />
    </article>
  );
}
