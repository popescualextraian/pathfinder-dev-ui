import { useState } from 'react';
import type { ScheduleResult, ScheduleSummary } from '../api/models';
import { scheduleHref, taskHref } from '../state/use-route';
import { Button } from './Button';
import { ScheduleOutcome } from './ScheduleOutcome';
import { describeWhen, formatTime } from './schedule-when';
import styles from './ScheduleList.module.css';

interface Props {
  schedules: ScheduleSummary[];
  loading: boolean;
  error: string | null;
  pending: boolean;
  actionError: string | null;
  onNew: () => void;
  onEdit: (id: string) => void;
  /** Runs now; resolves with the result (maybe skipped or refused), null when the call failed. */
  onRun: (id: string) => Promise<ScheduleResult | null>;
  onToggle: (schedule: ScheduleSummary, enabled: boolean) => Promise<boolean> | void;
}

/** What a Run now did, in one line. */
export function runNotice(title: string, r: ScheduleResult): string {
  if (r.outcome === 'running' && r.taskId) return `${title} started task ${r.taskId}.`;
  return `${title} ${r.outcome}${r.reason ? `: ${r.reason}` : ''}.`;
}

export function ScheduleList({ schedules, loading, error, pending, actionError, onNew, onEdit, onRun, onToggle }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const zone = schedules.find((s) => s.zone)?.zone;

  const run = async (s: ScheduleSummary) => {
    setNotice(null);
    const result = await onRun(s.id);
    if (result) setNotice(runNotice(s.title, result));
  };

  return (
    <section className={styles.list} aria-label="Schedules">
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1>Schedules</h1>
          {zone && <span className={styles.zone}>Times in {zone}</span>}
        </div>
        {schedules.length > 0 && (
          <Button variant="primary" onClick={onNew}>
            New schedule
          </Button>
        )}
      </header>
      {error && (
        <p className={styles.error} role="alert">
          Could not load schedules: {error}
        </p>
      )}
      {actionError && (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {loading && schedules.length === 0 && !error && <p className={styles.empty}>Loading schedules…</p>}
      {!loading && schedules.length === 0 && !error && (
        <div className={styles.emptyState}>
          <p className={styles.empty}>No schedules yet. A schedule starts a task with your prompt at the times you choose.</p>
          <Button variant="primary" onClick={onNew}>
            New schedule
          </Button>
        </div>
      )}
      <ul className={styles.rows}>
        {schedules.map((s) => (
          <li key={s.id} className={`${styles.row} ${s.enabled ? '' : styles.off}`} data-testid={`schedule-row-${s.id}`}>
            <div className={styles.text}>
              <a className={styles.title} href={scheduleHref(s.id)}>
                {s.title}
              </a>
              <span className={styles.when}>
                {describeWhen(s.when)} ·{' '}
                {!s.enabled ? 'Off' : s.nextRunAt ? `Next ${formatTime(s.nextRunAt, s.zone)}` : 'No next run'}
              </span>
              <span className={styles.last}>
                {s.lastResult ? (
                  <>
                    <ScheduleOutcome outcome={s.lastResult.outcome} />
                    <span>{formatTime(s.lastResult.firedAt, s.zone)}</span>
                    {s.lastResult.taskId && <a href={taskHref(s.lastResult.taskId)}>{s.lastResult.taskId}</a>}
                  </>
                ) : (
                  'Not run yet'
                )}
              </span>
            </div>
            <div className={styles.actions}>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  disabled={pending}
                  aria-label={`Enabled ${s.title}`}
                  onChange={(e) => void onToggle(s, e.target.checked)}
                />
                Enabled
              </label>
              <Button disabled={pending} onClick={() => void run(s)} aria-label={`Run ${s.title} now`}>
                Run now
              </Button>
              <Button onClick={() => onEdit(s.id)} aria-label={`Edit ${s.title}`}>
                Edit
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
