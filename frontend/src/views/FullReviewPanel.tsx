import { useId } from 'react';
import type { FullReview, FullReviewFinding, Model } from '../api/models';
import { formatAgo } from './format-age';
import styles from './FullReviewPanel.module.css';

interface Props {
  review: FullReview | null;
  /** Why `full.json` could not be read (the picture still shows). */
  error: string | null;
  model: Model;
  onSelect: (id: string) => void;
}

/** The last full review: when, at which commit, its open findings and accepted exceptions. */
export function FullReviewPanel({ review, error, model, onSelect }: Props) {
  const headingId = useId();
  const names = new Map(model.components.map((c) => [c.id, c.name]));
  const findings = review?.findings ?? [];
  const open = findings.filter((f) => f.status === 'open');
  const accepted = findings.filter((f) => f.status === 'accepted');
  const fixed = findings.length - open.length - accepted.length;

  const list = (label: string, items: FullReviewFinding[]) =>
    items.length > 0 && (
      <>
        <h4 className={styles.label}>{label}</h4>
        <ul className={styles.findings} aria-label={label}>
          {items.map((f) => {
            const name = names.get(f.component);
            return (
              <li key={f.id} className={styles.finding} data-status={f.status} data-severity={f.severity}>
                <span className={styles.head}>
                  {name ? (
                    <button type="button" className={styles.component} onClick={() => onSelect(f.component)}>
                      {name}
                    </button>
                  ) : (
                    <span className={styles.unknown}>{f.component}</span>
                  )}
                  <span className={styles.meta}>
                    {f.rule} · {f.severity} · {f.source}
                  </span>
                </span>
                <span>{f.text}</span>
              </li>
            );
          })}
        </ul>
      </>
    );

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.title}>
        Full review
      </h3>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!review && !error && <p className={styles.none}>No full review yet.</p>}
      {review && (
        <>
          <p className={styles.when}>
            <span className={styles.commit}>{review.commit.slice(0, 7)}</span> · {formatAgo(review.reviewedAt)}
          </p>
          <p className={styles.counts}>
            {open.length} open · {accepted.length} accepted · {fixed} fixed
          </p>
          {list('Open findings', open)}
          {list('Accepted exceptions', accepted)}
        </>
      )}
    </section>
  );
}
