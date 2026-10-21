import { useState } from 'react';
import type { ScheduleRecord, ScheduleResult } from '../api/models';
import { taskHref } from '../state/use-route';
import { Button } from './Button';
import { ConfirmDialog } from './Dialog';
import { ScheduleOutcome } from './ScheduleOutcome';
import { runNotice } from './ScheduleList';
import { describeWhen, formatClock, formatDuration, formatTime } from './schedule-when';
import styles from './ScheduleDetail.module.css';

/** What every scheduled task may do (as every UI task): not chosen per schedule. */
export const SCHEDULE_GRANTS = 'push, open-pr';

interface Props {
  schedule: ScheduleRecord;
  pending: boolean;
  actionError: string | null;
  onBack: () => void;
  onEdit: () => void;
  onRun: () => Promise<ScheduleResult | null>;
  onToggle: (enabled: boolean) => Promise<boolean> | void;
  /** Resolves true when deleted. */
  onDelete: () => Promise<boolean>;
  now?: number;
}

function ResultLine({ result, schedule, now }: { result: ScheduleResult; schedule: ScheduleRecord; now: number }) {
  const fired = Date.parse(result.firedAt);
  let length: string | null = null;
  if (result.outcome === 'running') {
    const limit = fired + schedule.timeoutMinutes * 60_000;
    length = `working for ${Math.max(0, Math.floor((now - fired) / 60_000))} min, time limit at ${formatClock(limit, schedule.zone)}`;
  } else if (result.endedAt) {
    length = `took ${formatDuration(Date.parse(result.endedAt) - fired)}`;
  }
  return (
    <li className={styles.result}>
      <div className={styles.resultHead}>
        <span className={styles.time}>{formatTime(result.firedAt, schedule.zone)}</span>
        <span className={styles.trigger}>{result.trigger === 'manual' ? 'Run now' : 'By schedule'}</span>
        <ScheduleOutcome outcome={result.outcome} />
        {length && <span className={styles.length}>{length}</span>}
        {result.taskId && (
          <span className={styles.task}>
            <a href={taskHref(result.taskId)}>{result.taskId}</a>
            {result.branch && <code>{result.branch}</code>}
          </span>
        )}
      </div>
      {result.reason && <p className={styles.reason}>{result.reason}</p>}
      {result.summary && <pre className={styles.summary}>{result.summary}</pre>}
    </li>
  );
}

export function ScheduleDetail({ schedule, pending, actionError, onBack, onEdit, onRun, onToggle, onDelete, now = Date.now() }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const zone = schedule.zone;

  const run = async () => {
    setNotice(null);
    const result = await onRun();
    if (result) setNotice(runNotice(schedule.title, result));
  };

  return (
    <article className={styles.detail} aria-label={schedule.title}>
      <Button className={styles.back} onClick={onBack}>
        ← All schedules
      </Button>
      <header className={styles.header}>
        <h1>{schedule.title}</h1>
        <div className={styles.actions}>
          <label className={styles.toggle}>
            <input type="checkbox" checked={schedule.enabled} disabled={pending} onChange={(e) => void onToggle(e.target.checked)} />
            Enabled
          </label>
          <Button disabled={pending} onClick={() => void run()}>
            Run now
          </Button>
          <Button variant="primary" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="danger" disabled={pending} onClick={() => setConfirming(true)}>
            Delete
          </Button>
        </div>
      </header>
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
      <section className={styles.settings} aria-label="Settings">
        <dl className={styles.facts}>
          <dt>Repository</dt>
          <dd>
            {schedule.repository}
            {schedule.ref && <code className={styles.ref}>{schedule.ref}</code>}
          </dd>
          <dt>Model</dt>
          <dd>{schedule.model || 'default'}</dd>
          <dt>When</dt>
          <dd>{describeWhen(schedule.when)}</dd>
          <dt>Next run</dt>
          <dd>
            {!schedule.enabled ? 'Off' : schedule.nextRunAt ? formatTime(schedule.nextRunAt, zone) : 'none'}
            {zone && schedule.enabled && schedule.nextRunAt && ` (${zone})`}
          </dd>
          <dt>Time limit</dt>
          <dd>{schedule.timeoutMinutes} min</dd>
          <dt>Grants</dt>
          <dd>{SCHEDULE_GRANTS}</dd>
        </dl>
        <h2>Prompt</h2>
        <pre className={styles.prompt}>{schedule.prompt}</pre>
      </section>
      <section className={styles.results}>
        <h2 id="schedule-results">Results</h2>
        {schedule.results.length === 0 ? (
          <p className={styles.empty}>No runs yet.</p>
        ) : (
          <ul aria-labelledby="schedule-results" className={styles.resultList}>
            {schedule.results.map((r) => (
              <ResultLine key={`${r.firedAt}-${r.outcome}`} result={r} schedule={schedule} now={now} />
            ))}
          </ul>
        )}
      </section>
      {confirming && (
        <ConfirmDialog
          title={`Delete schedule "${schedule.title}"?`}
          message="The schedule and its results are removed. Tasks it started stay."
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            setConfirming(false);
            void onDelete();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </article>
  );
}
