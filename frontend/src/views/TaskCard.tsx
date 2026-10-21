import type { Task } from '../api/models';
import { ScheduleChip } from './ScheduleChip';
import { StatePill } from './StatePill';
import { formatAge } from './format-age';
import styles from './TaskCard.module.css';

interface Props {
  task: Task;
  selected: boolean;
  onSelect: (id: string) => void;
  now?: number;
}

export function cardLine(task: Task): string {
  // A finished scheduled run: the first line of its summary.
  if (task.summaryLine) return task.summaryLine;
  return task.questions[0]?.text ?? task.lastMessage ?? task.summary ?? '';
}

/** Name of the session that is asking, when the task has several sessions and needs you. */
function askingSession(task: Task): string | null {
  if (task.sessions.length < 2 || task.section !== 'needs-you') return null;
  return task.questions[0]?.session ?? null;
}

export function TaskCard({ task, selected, onSelect, now }: Props) {
  // The card is a button; the schedule link sits beside it (no link inside a button), drawn inside the card's box.
  return (
    <div className={`${styles.card} ${selected ? styles.selected : ''}`}>
      <button type="button" className={styles.hit} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(task.id)}>
        <span className={styles.head}>
          <span className={styles.title}>{task.title}</span>
          <StatePill state={task.state} section={task.section} label={task.closed ? 'closed' : undefined} />
        </span>
        <span className={styles.line}>{cardLine(task)}</span>
        <span className={styles.meta}>
          <span className={styles.branch}>{task.branch}</span>
          {task.kind === 'workflow-generator' && <span className={styles.kind}>Workflow generator</span>}
          {task.sessions.length > 1 && <span className={styles.sessions}>{task.sessions.length} sessions</span>}
          {askingSession(task) && (
            <span className={styles.asking} data-testid="card-asking">
              {askingSession(task)} asks
            </span>
          )}
          <span className={styles.age}>{formatAge(task.createdAt, now)}</span>
        </span>
      </button>
      {task.scheduleId && (
        <span className={styles.schedule}>
          <ScheduleChip id={task.scheduleId} title={task.scheduleTitle} />
        </span>
      )}
    </div>
  );
}
