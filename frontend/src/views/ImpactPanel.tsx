import { useId } from 'react';
import type { Model, PlanChange, PlanReview } from '../api/models';
import { ChangeMark } from './ChangeMark';
import styles from './ImpactPanel.module.css';

interface Props {
  review: PlanReview;
  model: Model;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** "Layer · Module" of a proposed component, names from the model. */
function proposedPlace(model: Model, change: PlanChange): string | null {
  const p = change.proposed;
  if (!p) return null;
  const part = model.parts.find((x) => x.id === p.part);
  const layer = part?.layers.find((l) => l.id === p.layer)?.name ?? p.layer;
  const module = p.module === null ? null : (part?.modules.find((m) => m.id === p.module)?.name ?? p.module);
  return [layer, module].filter(Boolean).join(' · ');
}

/** What a plan does to the architecture: its changes, the rule check and its size. */
export function ImpactPanel({ review, model, selectedId, onSelect }: Props) {
  const headingId = useId();
  const names = new Map(model.components.map((c) => [c.id, c.name]));
  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <header className={styles.header}>
        <h3 id={headingId} className={styles.title}>
          {review.title}
        </h3>
        <span className={styles.size}>Size {review.size}</span>
      </header>
      <p className={styles.summary}>{review.summary}</p>
      <p className={styles.plan}>{review.plan}</p>

      <h4 className={styles.label}>Changes</h4>
      <ul className={styles.changes} aria-label="Changes">
        {review.changes.map((c) => {
          const place = proposedPlace(model, c);
          const name = names.get(c.component) ?? c.proposed?.name ?? c.component;
          const isSelected = c.component === selectedId;
          return (
            <li key={c.component}>
              <button
                type="button"
                className={`${styles.change} ${isSelected ? styles.selected : ''}`}
                data-component={c.component}
                data-change={c.change}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => onSelect(c.component)}
              >
                <span className={styles.changeHead}>
                  <ChangeMark change={c.change} />
                  {c.change === 'removed' ? <s className={styles.name}>{name}</s> : <span className={styles.name}>{name}</span>}
                  {place && <span className={styles.place}>{place}</span>}
                </span>
                <span className={styles.line}>{c.line}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <h4 className={styles.label}>Rule check</h4>
      <ul className={styles.rules} aria-label="Rule check">
        {review.findings.map((f) => (
          <li key={f.id} className={`${styles.rule} ${styles.failed}`} data-status={f.status}>
            <span className={styles.ruleHead}>
              <span aria-hidden="true" className={styles.warn}>
                ⚠
              </span>
              <span className={styles.ruleName}>{f.rule}</span>
              <button type="button" className={styles.componentLink} onClick={() => onSelect(f.component)}>
                {names.get(f.component) ?? f.component}
              </button>
              {f.status !== 'open' && <span className={styles.status}>{f.status}</span>}
            </span>
            <span>{f.text}</span>
            {f.alternative && <span className={styles.alternative}>Instead: {f.alternative}</span>}
          </li>
        ))}
        {review.passed.map((rule) => (
          <li key={`passed-${rule}`} className={styles.rule} data-status="passed">
            <span className={styles.ruleHead}>
              <span aria-hidden="true" className={styles.tick}>
                ✓
              </span>
              <span className={styles.ruleName}>{rule}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
