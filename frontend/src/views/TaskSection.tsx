import { useState } from 'react';
import type { Task } from '../api/models';
import { TaskCard } from './TaskCard';
import styles from './TaskSection.module.css';

interface Props {
  title: string;
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Done section: hidden behind "N closed tasks" until shown. */
  collapsible?: boolean;
  now?: number;
}

export function TaskSection({ title, tasks, selectedId, onSelect, collapsible, now }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (tasks.length === 0) return null;
  const open = !collapsible || expanded || tasks.some((t) => t.id === selectedId);
  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.kicker}>
        {title} <span className={styles.count}>{tasks.length}</span>
      </h3>
      {open ? (
        <ul className={styles.cards}>
          {tasks.map((t) => (
            <li key={t.id}>
              <TaskCard task={t} selected={t.id === selectedId} onSelect={onSelect} now={now} />
            </li>
          ))}
        </ul>
      ) : (
        <button type="button" className={styles.collapsed} onClick={() => setExpanded(true)}>
          <span>▸ {tasks.length} closed tasks</span>
          <span className={styles.show}>show</span>
        </button>
      )}
    </section>
  );
}
