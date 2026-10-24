import type { RefusedReview, ReviewSummary } from '../api/models';
import { formatAgo } from './format-age';
import styles from './ReviewList.module.css';

interface Props {
  reviews: ReviewSummary[];
  refused: RefusedReview[];
  /** Branches beyond the first 100 were not searched. */
  truncated?: boolean;
  selected: { branch: string; slug: string } | null;
  /** Ids of the engine's tasks: a review on a task branch links to its task only when known. */
  knownTaskIds: string[];
  onSelect: (branch: string, slug: string) => void;
  onOpenTask: (taskId: string) => void;
}

const TASK_BRANCH = /^agentic\/(T-\d{8}-[a-z0-9]{4,})/;

/** The task id of an agentic task branch, if any. */
export function taskIdOfBranch(branch: string): string | null {
  return TASK_BRANCH.exec(branch)?.[1] ?? null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The plan reviews of a repository, newest first as given, plus the files that were refused. */
export function ReviewList({ reviews, refused, truncated, selected, knownTaskIds, onSelect, onOpenTask }: Props) {
  const known = new Set(knownTaskIds);
  return (
    <div className={styles.list}>
      {reviews.length === 0 && <p className={styles.empty}>No plan reviews yet.</p>}
      {reviews.length > 0 && (
        <ul className={styles.rows} aria-label="Plan reviews">
          {reviews.map((r) => {
            const isSelected = selected?.branch === r.branch && selected.slug === r.slug;
            const taskId = taskIdOfBranch(r.branch);
            return (
              <li
                key={`${r.branch}/${r.slug}`}
                className={`${styles.row} ${isSelected ? styles.selected : ''}`}
                data-testid={`review-${r.branch}/${r.slug}`}
              >
                <button
                  type="button"
                  className={styles.select}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => onSelect(r.branch, r.slug)}
                >
                  <span className={styles.title}>{r.title}</span>
                  <span className={styles.meta}>
                    <span className={styles.branch}>{r.branch}</span>
                    <span>{formatAgo(r.reviewedAt)}</span>
                    <span>Size {r.size}</span>
                  </span>
                  <span className={styles.meta}>
                    <span>{plural(r.touched.length, 'component')}</span>
                    <span className={r.openFindings ? styles.open : undefined}>
                      {r.openFindings ? plural(r.openFindings, 'open finding') : 'no open findings'}
                    </span>
                  </span>
                </button>
                {taskId && known.has(taskId) && (
                  <button type="button" className={styles.task} onClick={() => onOpenTask(taskId)}>
                    {taskId}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {truncated && <p className={styles.empty}>Only the 100 most recently updated branches are searched.</p>}
      {refused.length > 0 && (
        <>
          <h4 className={styles.refusedHeading}>Refused review files</h4>
          <ul className={styles.refused} aria-label="Refused review files">
            {refused.map((r) => (
              <li key={`${r.branch}/${r.file}`} className={styles.refusedRow}>
                <span className={styles.meta}>
                  <span className={styles.branch}>{r.branch}</span>
                  <span className={styles.file}>{r.file}</span>
                </span>
                <span className={styles.error}>{r.error}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
