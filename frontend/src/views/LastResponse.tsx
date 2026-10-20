import { useState } from 'react';
import { formatAge } from './format-age';
import styles from './TaskView.module.css';

interface Source {
  lastMessage?: string;
  lastMessageAt?: string;
  summary?: string;
}

export function LastResponse({ task }: { task: Source }) {
  const [open, setOpen] = useState(false);
  const text = task.lastMessage ?? task.summary;
  if (!text) return null;
  const long = text.length > 300 || text.split('\n').length > 4;
  return (
    <section aria-label="Last response">
      <h3 className={styles.kicker}>
        Last response
        {task.lastMessage && task.lastMessageAt ? ` · ${formatAge(task.lastMessageAt)}` : ''}
      </h3>
      <p className={open || !long ? styles.block : `${styles.block} ${styles.clamped}`}>{text}</p>
      {long && (
        <button type="button" className={styles.link} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'show less' : 'show more'}
        </button>
      )}
    </section>
  );
}
