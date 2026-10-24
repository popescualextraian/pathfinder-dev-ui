import { useId } from 'react';
import type { FullReviewFinding, Model, PlanChange, PlanFinding } from '../api/models';
import type { GridComponent } from './architecture-layout';
import { ChangeMark } from './ChangeMark';
import styles from './ComponentPanel.module.css';

interface Props {
  component: GridComponent | undefined;
  model: Model;
  /** This component's change in the shown plan, if any. */
  change?: PlanChange;
  /** Findings of the full review or the plan; only this component's are shown. */
  findings: (FullReviewFinding | PlanFinding)[];
  /** Base URL of the component pages (`pageBase + page`), null when unknown. */
  pageBase: string | null;
  onSelect: (id: string) => void;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Where a component sits: "Module · Layer · Part" (module left out when it has none). */
export function placeOf(model: Model, c: Pick<GridComponent, 'part' | 'layer' | 'module'>): string {
  const part = model.parts.find((p) => p.id === c.part);
  const layer = part?.layers.find((l) => l.id === c.layer);
  const module = c.module === null ? null : (part?.modules.find((m) => m.id === c.module)?.name ?? c.module);
  return [module, layer?.name ?? c.layer, part?.name ?? c.part].filter(Boolean).join(' · ');
}

/** The selected component: summary, place, connections, findings, its line in the plan, its page. */
export function ComponentPanel({ component, model, change, findings, pageBase, onSelect }: Props) {
  const headingId = useId();
  if (!component) {
    return (
      <aside className={styles.panel}>
        <p className={styles.hint}>Select a component to see what it does and what it talks to.</p>
      </aside>
    );
  }
  const id = component.id;
  const names = new Map(model.components.map((c) => [c.id, c.name]));
  const proposedTo = change?.component === id ? (change.proposed?.talks_to ?? []).map((t) => t.to) : [];
  const talksTo = unique([...model.connections.filter((c) => c.from === id).map((c) => c.to), ...proposedTo]);
  const usedBy = unique(model.connections.filter((c) => c.to === id).map((c) => c.from));
  const own = findings.filter((f) => f.component === id);

  const links = (label: string, ids: string[]) => (
    <div className={styles.group}>
      <h4 className={styles.label}>{label}</h4>
      {ids.length ? (
        <ul className={styles.links} aria-label={label}>
          {ids.map((other) => (
            <li key={other}>
              <button type="button" className={styles.link} onClick={() => onSelect(other)}>
                {names.get(other) ?? other}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.none}>None</p>
      )}
    </div>
  );

  return (
    <aside className={styles.panel} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.name}>
        {component.state === 'removed' ? <s>{component.name}</s> : component.name}
      </h3>
      <p className={styles.place}>{placeOf(model, component)}</p>
      <p className={styles.summary}>{component.summary}</p>
      {change && (
        <p className={styles.plan}>
          <span className={styles.label}>In this plan</span> <ChangeMark change={change.change} /> {change.line}
        </p>
      )}
      {links('Talks to', talksTo)}
      {links('Used by', usedBy)}
      <div className={styles.group}>
        <h4 className={styles.label}>Findings</h4>
        {own.length ? (
          <ul className={styles.findings}>
            {own.map((f) => (
              <li key={f.id} className={styles.finding} data-status={f.status} data-severity={f.severity}>
                <span className={styles.meta}>
                  {f.rule} · {f.severity} · {f.status}
                </span>
                <span>{f.text}</span>
                {'alternative' in f && f.alternative && <span className={styles.alternative}>Instead: {f.alternative}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.none}>No findings</p>
        )}
      </div>
      {pageBase && component.page && (
        <a className={styles.page} href={pageBase + component.page} target="_blank" rel="noreferrer">
          Open the component page
        </a>
      )}
    </aside>
  );
}
