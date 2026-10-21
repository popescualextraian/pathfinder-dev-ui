import type { ScheduleOutcome as Outcome } from '../api/models';
import styles from './ScheduleOutcome.module.css';

/** A result's outcome as a pill, colored like the task states. */
export function ScheduleOutcome({ outcome }: { outcome: Outcome }) {
  return (
    <span className={`${styles.pill} ${styles[outcome]}`} data-outcome={outcome}>
      {outcome}
    </span>
  );
}
