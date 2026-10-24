import { useEffect, useMemo, useState } from 'react';
import type { Repository, ReviewDetail } from './api/models';
import { useArchitecture, useArchitectureReviews, useReviewDetail } from './state/use-architecture';
import { ArchitectureGrid } from './views/ArchitectureGrid';
import { buildGrid, type GridComponent } from './views/architecture-layout';
import { ComponentPanel } from './views/ComponentPanel';
import { FullReviewPanel } from './views/FullReviewPanel';
import { ImpactPanel } from './views/ImpactPanel';
import { ReviewList } from './views/ReviewList';
import styles from './ArchitectPage.module.css';

type ReviewRef = { branch: string; slug: string };

interface Props {
  /** The repositories the page may show (configured ones, in the engine's order). */
  repositories: Repository[];
  /** The one shown; null: the default repository. */
  repository: string | null;
  /** The plan review shown (reviews tab), null for none. */
  review: ReviewRef | null;
  /** Task ids that exist, to link a review's `agentic/T-…` branch to its task. */
  knownTaskIds: string[];
  onSelectRepository: (name: string) => void;
  onSelectReview: (review: ReviewRef | null) => void;
  onOpenTask: (id: string) => void;
}

type Tab = 'current' | 'reviews';

function componentOf(blocks: ReturnType<typeof buildGrid>, id: string | null): GridComponent | undefined {
  if (id === null) return undefined;
  for (const block of blocks) {
    for (const row of block.rows) {
      const found = [...row.spanning, ...row.cells.flat()].find((c) => c.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

/** A plan review: its picture with the overlay, the selected component and the impact. */
function ReviewView({ detail, selectedId, onSelect }: { detail: ReviewDetail; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { model, review, pageBase } = detail;
  const blocks = useMemo(() => buildGrid(model, review.changes), [model, review.changes]);
  const component = componentOf(blocks, selectedId);
  return (
    <div className={styles.pictureWithSide}>
      <div className={styles.picture}>
        <ArchitectureGrid model={model} changes={review.changes} selectedId={selectedId} onSelect={onSelect} />
      </div>
      <div className={styles.side}>
        {component && (
          <ComponentPanel
            component={component}
            model={model}
            change={review.changes.find((c) => c.component === component.id)}
            findings={review.findings}
            pageBase={pageBase}
            onSelect={onSelect}
          />
        )}
        <ImpactPanel review={review} model={model} selectedId={selectedId} onSelect={onSelect} />
      </div>
    </div>
  );
}

function ReviewDetailView({ repository, review, selectedId, onSelect }: { repository: string | null; review: ReviewRef; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const d = useReviewDetail(repository, review.branch, review.slug);
  if (d.loading) return <p className={styles.state}>Loading the plan review…</p>;
  if (!d.data) {
    return (
      <p className={styles.error} role="alert">
        {d.notFound ? `The plan review ${review.slug} on ${review.branch} was not found.` : `Could not load the plan review: ${d.error}`}
      </p>
    );
  }
  return <ReviewView detail={d.data} selectedId={selectedId} onSelect={onSelect} />;
}

/** The Architect page: the architecture picture of a repository, its full review and its plan reviews. */
export function ArchitectPage({ repositories, repository, review, knownTaskIds, onSelectRepository, onSelectReview, onOpenTask }: Props) {
  const shownName = repository ?? repositories.find((r) => r.default)?.name ?? repositories[0]?.name ?? '';
  const current = useArchitecture(repository);
  const reviews = useArchitectureReviews(repository);
  const [tab, setTab] = useState<Tab>(review ? 'reviews' : 'current');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const shownTab: Tab = review ? 'reviews' : tab;

  // Another repository opens on its current architecture (unless the link names a review).
  const hasReview = review !== null;
  useEffect(() => {
    if (!hasReview) setTab('current');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);
  // Another repository, plan review or tab: nothing selected there.
  const reviewKey = review ? `${review.branch}/${review.slug}` : '';
  useEffect(() => setSelectedId(null), [repository, reviewKey, shownTab]);

  const data = current.data;
  const blocks = useMemo(() => (data ? buildGrid(data.model) : []), [data]);
  const selected = componentOf(blocks, selectedId);
  const count = reviews.list ? ` (${reviews.list.reviews.length})` : '';

  const showTab = (next: Tab) => {
    setTab(next);
    if (next === 'current' && review) onSelectReview(null);
  };

  const source = review
    ? `Source: docs/architecture/reviews/plans/${review.slug}.json on ${review.branch}`
    : data && shownTab === 'current'
      ? `Source: docs/architecture/ (model.json, reviews/full.json) on ${data.branch}`
      : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Architect</h1>
        <label className={styles.repo}>
          <span>Repository</span>
          <select aria-label="Repository" value={shownName} onChange={(e) => onSelectRepository(e.target.value)}>
            {repositories.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {data && (
          <>
            <span className={styles.pill}>{data.model.style.name}</span>
            <span className={`${styles.pill} ${styles.mono}`}>
              doc on {data.branch} @ {data.sha.slice(0, 7)}
            </span>
          </>
        )}
      </header>

      <div role="tablist" className={styles.tabs} aria-label="Architect views">
        <button type="button" role="tab" aria-selected={shownTab === 'current'} className={styles.tab} onClick={() => showTab('current')}>
          Current architecture
        </button>
        <button type="button" role="tab" aria-selected={shownTab === 'reviews'} className={styles.tab} onClick={() => showTab('reviews')}>
          {`Plan reviews${count}`}
        </button>
      </div>

      {shownTab === 'current' && (
        <div role="tabpanel" aria-label="Current architecture" className={styles.panel}>
          {current.loading && <p className={styles.state}>Loading the architecture…</p>}
          {current.notFound && (
            <div className={styles.empty}>
              <p>
                No architecture doc on the default branch of {shownName}. Run the architect skill in a task:{' '}
                <code>/architect seed</code>, then push the branch.
              </p>
            </div>
          )}
          {!current.loading && !current.notFound && current.error && (
            <p className={styles.error} role="alert">
              Could not load the architecture: {current.error}
            </p>
          )}
          {data && (
            <div className={styles.pictureWithSide}>
              <div className={styles.picture}>
                <ArchitectureGrid model={data.model} findings={data.fullReview?.findings} selectedId={selectedId} onSelect={setSelectedId} />
              </div>
              <div className={styles.side}>
                {selected && (
                  <ComponentPanel
                    component={selected}
                    model={data.model}
                    findings={data.fullReview?.findings ?? []}
                    pageBase={data.pageBase}
                    onSelect={setSelectedId}
                  />
                )}
                <FullReviewPanel review={data.fullReview} error={data.fullReviewError} model={data.model} onSelect={setSelectedId} />
              </div>
            </div>
          )}
        </div>
      )}

      {shownTab === 'reviews' && (
        <div role="tabpanel" aria-label="Plan reviews" className={`${styles.panel} ${styles.reviews}`}>
          <div className={styles.reviewList}>
            {reviews.loading && <p className={styles.state}>Loading plan reviews…</p>}
            {reviews.error && (
              <p className={styles.error} role="alert">
                Could not load the plan reviews: {reviews.error}
              </p>
            )}
            {reviews.list && (
              <ReviewList
                reviews={reviews.list.reviews}
                refused={reviews.list.refused}
                truncated={reviews.list.truncated}
                selected={review}
                knownTaskIds={knownTaskIds}
                onSelect={(branch, slug) => onSelectReview({ branch, slug })}
                onOpenTask={onOpenTask}
              />
            )}
          </div>
          <div className={styles.reviewMain}>
            {review ? (
              <ReviewDetailView repository={repository} review={review} selectedId={selectedId} onSelect={setSelectedId} />
            ) : (
              <p className={styles.hint}>Select a plan review to see what it changes in the architecture.</p>
            )}
          </div>
        </div>
      )}

      {source && <footer className={styles.footer}>{source}</footer>}
    </div>
  );
}
