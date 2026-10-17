import type { Task } from '../api/models';
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
  return task.questions[0]?.text ?? task.lastMessage ?? task.summary ?? '';
}

export function TaskCard({ task, selected, onSelect, now }: Props) {
  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(task.id)}
    >
      <span className={styles.head}>
        <span className={styles.title}>{task.title}</span>
        <StatePill state={task.state} section={task.section} label={task.closed ? 'closed' : undefined} />
      </span>
      <span className={styles.line}>{cardLine(task)}</span>
      <span className={styles.meta}>
        <span className={styles.branch}>{task.branch}</span>
        <span className={styles.age}>{formatAge(task.createdAt, now)}</span>
      </span>
    </button>
  );
}
