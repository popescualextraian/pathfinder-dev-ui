import type { Task, TaskSection as Section } from '../api/models';
import { TaskSection } from './TaskSection';
import styles from './TaskList.module.css';

interface Props {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  error?: string | null;
  now?: number;
}

const SECTIONS: { key: Section; title: string }[] = [
  { key: 'needs-you', title: 'Needs you' },
  { key: 'working', title: 'Working' },
  { key: 'in-review', title: 'In review' },
  { key: 'done', title: 'Done' },
];

export function TaskList({ tasks, selectedId, onSelect, loading, error, now }: Props) {
  return (
    <div className={styles.list}>
      {error && (
        <p role="alert" className={styles.error}>
          Could not load tasks: {error}
        </p>
      )}
      {loading && tasks.length === 0 && !error && <p className={styles.note}>Loading tasks…</p>}
      {!loading && !error && tasks.length === 0 && <p className={styles.note}>No tasks yet.</p>}
      {SECTIONS.map((s) => (
        <TaskSection
          key={s.key}
          title={s.title}
          tasks={tasks.filter((t) => t.section === s.key)}
          selectedId={selectedId}
          onSelect={onSelect}
          collapsible={s.key === 'done'}
          now={now}
        />
      ))}
    </div>
  );
}
