import type { TaskSection, TaskState } from '../api/models';
import styles from './StatePill.module.css';

interface Props {
  state: TaskState;
  section: TaskSection;
  /** Overrides the label (e.g. "closed"). */
  label?: string;
}

export function StatePill({ state, section, label }: Props) {
  return (
    <span className={`${styles.pill} ${styles[section]}`} data-section={section}>
      <span className={styles.dot} aria-hidden="true" />
      {label ?? state}
    </span>
  );
}
