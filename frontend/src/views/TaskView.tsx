import { useState } from 'react';
import type { SessionView, Task } from '../api/models';
import { MAIN_SESSION, resolveSession } from '../state/use-route';
import { useTaskActions } from '../state/use-task-actions';
import { AddSessionDialog } from './AddSessionDialog';
import { SessionTabs } from './SessionTabs';
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
  /** Receives the Task returned by an action (upsert into the list). */
  onTask?: (task: Task) => void;
  /** Requested session from the route (null/absent = main); unknown names fall back to main. */
  session?: string | null;
  /** Selects a session; main is reported as null. */
  onSelectSession?: (session: string | null) => void;
}

export function TaskView({ task, loading, error, onDeleted, onTask, session, onSelectSession }: Props) {
  if (!task) {
    return (
      <p className={styles.empty} role={error ? 'alert' : undefined}>
        {error ?? (loading ? 'Loading…' : 'Select a task')}
      </p>
    );
  }
  return (
    <TaskDetail
      key={task.id}
      task={task}
      onDeleted={onDeleted}
      onTask={onTask}
      session={session}
      onSelectSession={onSelectSession}
    />
  );
}

interface DetailProps {
  task: Task;
  onDeleted: () => void;
  onTask?: (task: Task) => void;
  session?: string | null;
  onSelectSession?: (session: string | null) => void;
}

/** Sessions of a task; an older task without any shows one main session built from the task. */
function sessionsOf(task: Task): SessionView[] {
  if (task.sessions?.length) return task.sessions;
  return [
    {
      name: MAIN_SESSION,
      state: task.state,
      createdAt: task.createdAt,
      lastMessage: task.lastMessage,
      lastMessageAt: task.lastMessageAt,
      questions: task.questions.length,
    },
  ];
}

function TaskDetail({ task, onDeleted, onTask, session, onSelectSession }: DetailProps) {
  const actions = useTaskActions(task.id, onTask);
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);
  const sessions = sessionsOf(task);
  const selected = resolveSession(session, sessions);
  const done = task.closed || task.state === 'stopped';
  const closed = task.closed;
  const headerError = actions.close.error ?? actions.remove.error;
  const select = (name: string) => onSelectSession?.(name === MAIN_SESSION ? null : name);

  const remove = async () => {
    if ((await actions.remove.run()).ok) onDeleted();
  };

  return (
    <article className={styles.view} aria-label={task.title}>
      <header className={styles.header}>
        <h2 className={styles.title}>{task.title}</h2>
        <StatePill state={task.state} section={task.section} label={closed ? 'closed' : undefined} />
        <div className={styles.actions}>
          {task.section !== 'working' && !closed && (
            <Button disabled={actions.close.pending} onClick={() => void actions.close.run()}>
              Close task
            </Button>
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
      <SessionTabs
        sessions={sessions}
        selected={selected}
        onSelect={select}
        onAdd={() => setAdding(true)}
        addDisabled={done}
      />
      <SessionPanel
        key={selected}
        task={task}
        sessions={sessions}
        name={selected}
        onTask={onTask}
        done={done}
      />
      {adding && (
        <AddSessionDialog
          taskId={task.id}
          sessions={sessions}
          onTask={onTask}
          onClose={() => setAdding(false)}
          onAdded={(_, name) => {
            setAdding(false);
            select(name);
          }}
        />
      )}
    </article>
  );
}

interface PanelProps {
  task: Task;
  sessions: SessionView[];
  name: string;
  done: boolean;
  onTask?: (task: Task) => void;
}

/** One session: last response, its questions, cancel, full run and the reply box. */
function SessionPanel({ task, sessions, name, done, onTask }: PanelProps) {
  const isMain = name === MAIN_SESSION;
  // Prompt/answer/cancel name the session unless it is main (the bridge default).
  const actions = useTaskActions(task.id, onTask, isMain ? undefined : name);
  const [answering, setAnswering] = useState<string | null>(null);
  const [showRun, setShowRun] = useState(false);
  const session = sessions.find((s) => s.name === name) ?? sessions[0];
  const only = sessions.length === 1;
  const questions = task.questions.filter((q) => (q.session ?? MAIN_SESSION) === name);
  const running = session.state === 'running' || session.state === 'starting';
  const closed = task.closed;
  const source = {
    lastMessage: session.lastMessage ?? (only ? task.lastMessage : undefined),
    lastMessageAt: session.lastMessage ? session.lastMessageAt : only ? task.lastMessageAt : undefined,
    summary: isMain ? task.summary : undefined,
  };
  const error = actions.cancel.error;

  return (
    <div role="tabpanel" aria-labelledby={`session-tab-${name}`} data-testid="session-panel" className={styles.panelBody}>
      {running && (
        <div className={styles.actions}>
          <Button disabled={actions.cancel.pending} onClick={() => void actions.cancel.run()}>
            Cancel turn
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <LastResponse task={source} />
      {questions.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          disabled={done}
          pending={answering === q.id && actions.answer.pending}
          error={answering === q.id ? actions.answer.error : null}
          onAnswer={(text, question) => {
            setAnswering(question);
            void actions.answer.run(text, question);
          }}
        />
      ))}
      <button type="button" className={styles.runLink} onClick={() => setShowRun(!showRun)} aria-expanded={showRun}>
        {showRun ? 'Hide full run ▾' : 'View full run ▸'}
      </button>
      {showRun && <FullRun taskId={task.id} session={name} closed={closed} />}
      <ReplyBox
        disabled={done}
        stopped={!closed && task.state === 'stopped'}
        pending={actions.prompt.pending}
        error={actions.prompt.error}
        onSend={async (text) => (await actions.prompt.run(text)).ok}
      />
    </div>
  );
}
