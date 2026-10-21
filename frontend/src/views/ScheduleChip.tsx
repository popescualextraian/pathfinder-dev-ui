import { scheduleHref } from '../state/use-route';
import styles from './ScheduleChip.module.css';

/** ⏰ and the schedule's title, linking to the schedule (on a scheduled task's card and view). */
export function ScheduleChip({ id, title, testId }: { id: string; title?: string; testId?: string }) {
  return (
    <a className={styles.chip} href={scheduleHref(id)} title="Started by this schedule" data-testid={testId}>
      <span aria-hidden="true">⏰</span>
      <span className={styles.title}>{title || id}</span>
    </a>
  );
}
