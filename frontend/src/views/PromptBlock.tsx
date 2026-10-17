import { useState } from 'react';
import styles from './TaskView.module.css';

export function PromptBlock({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  const long = prompt.length > 240 || prompt.split('\n').length > 3;
  return (
    <section aria-label="Prompt">
      <h3 className={styles.kicker}>Prompt</h3>
      <p className={open || !long ? styles.block : `${styles.block} ${styles.clamped}`}>{prompt}</p>
      {long && (
        <button type="button" className={styles.link} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'show less' : 'show all'}
        </button>
      )}
    </section>
  );
}
