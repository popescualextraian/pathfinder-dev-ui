import { useId, useMemo, type CSSProperties } from 'react';
import type { FindingStatus, Model, PlanReview } from '../api/models';
import { buildGrid, connectedIds, type GridComponent } from './architecture-layout';
import { ChangeMark } from './ChangeMark';
import styles from './ArchitectureGrid.module.css';

interface Props {
  model: Model;
  /** A plan's changes: touched components are marked, the rest dimmed. */
  changes?: PlanReview['changes'];
  findings?: { component: string; status: FindingStatus }[];
  selectedId: string | null;
  /** The clicked component, or null when the selected one is clicked again. */
  onSelect: (id: string | null) => void;
}

interface Badges {
  open: number;
  accepted: boolean;
}

function badgesOf(findings: Props['findings']): Map<string, Badges> {
  const out = new Map<string, Badges>();
  for (const f of findings ?? []) {
    if (f.status === 'fixed') continue;
    const b = out.get(f.component) ?? { open: 0, accepted: false };
    if (f.status === 'open') b.open += 1;
    else b.accepted = true;
    out.set(f.component, b);
  }
  return out;
}

function Chip({
  c,
  badges,
  selected,
  linked,
  spanning,
  onClick,
}: {
  c: GridComponent;
  badges: Badges | undefined;
  selected: boolean;
  linked: boolean;
  spanning: boolean;
  onClick: () => void;
}) {
  const classes = [styles.chip, styles[c.state], selected && styles.selected, linked && styles.linked].filter(Boolean).join(' ');
  const change = c.state === 'new' || c.state === 'changed' || c.state === 'removed' ? c.state : null;
  return (
    <button
      type="button"
      className={classes}
      title={c.summary}
      aria-pressed={selected}
      data-testid={`chip-${c.id}`}
      data-state={c.state}
      data-linked={linked ? 'true' : 'false'}
      data-spanning={spanning ? 'true' : 'false'}
      onClick={onClick}
    >
      {change && <ChangeMark change={change} />}
      {change === 'removed' ? <s className={styles.name}>{c.name}</s> : <span className={styles.name}>{c.name}</span>}
      {badges && badges.open > 0 && (
        <span role="img" className={styles.open} aria-label={`${badges.open} open finding${badges.open === 1 ? '' : 's'}`}>
          {badges.open}
        </span>
      )}
      {badges?.accepted && (
        <span role="img" className={styles.accepted} aria-label="accepted exception">
          ✓
        </span>
      )}
    </button>
  );
}

/** The architecture picture: per part a grid of module columns and layer rows, built from the model. */
export function ArchitectureGrid({ model, changes, findings, selectedId, onSelect }: Props) {
  const idPrefix = useId();
  const blocks = useMemo(() => buildGrid(model, changes), [model, changes]);
  const badges = useMemo(() => badgesOf(findings), [findings]);
  const linked = useMemo(
    () => (selectedId ? connectedIds(model, selectedId, changes) : new Set<string>()),
    [model, selectedId, changes],
  );

  const chip = (c: GridComponent, spanning: boolean) => (
    <Chip
      key={c.id}
      c={c}
      badges={badges.get(c.id)}
      selected={c.id === selectedId}
      linked={linked.has(c.id)}
      spanning={spanning}
      onClick={() => onSelect(c.id === selectedId ? null : c.id)}
    />
  );

  return (
    <div className={styles.picture}>
      {blocks.map((block) => {
        const headingId = `${idPrefix}-part-${block.part.id}`;
        const withColumns = block.columns.some((col) => col.id !== null);
        const style = { '--columns': block.columns.length } as CSSProperties;
        return (
          <section key={block.part.id} className={styles.block} aria-labelledby={headingId}>
            <h3 id={headingId} className={styles.partName}>
              {block.part.name}
            </h3>
            <div role="table" className={styles.grid} style={style}>
              {withColumns && (
                <div role="row" className={styles.row}>
                  <span role="presentation" className={styles.corner} />
                  {block.columns.map((col) => (
                    <span key={col.id ?? ''} role="columnheader" className={styles.columnName}>
                      {col.name}
                    </span>
                  ))}
                </div>
              )}
              {block.rows.map((row) => {
                const hasCells = row.cells.some((cell) => cell.length > 0);
                const hasSpanning = row.spanning.length > 0;
                const spanningCell = (
                  <div role="cell" className={`${styles.cell} ${styles.spanning}`}>
                    {row.spanning.map((c) => chip(c, true))}
                  </div>
                );
                return (
                  <div key={row.layer.id} role="rowgroup" className={styles.rowGroup}>
                    <div role="row" className={styles.row}>
                      <span role="rowheader" className={styles.layerName}>
                        {row.layer.name}
                      </span>
                      {hasSpanning && !hasCells
                        ? spanningCell
                        : row.cells.map((cell, i) => (
                            <div key={block.columns[i].id ?? i} role="cell" className={styles.cell}>
                              {cell.map((c) => chip(c, false))}
                            </div>
                          ))}
                    </div>
                    {hasSpanning && hasCells && (
                      <div role="row" className={styles.row}>
                        <span role="cell" className={styles.corner} />
                        {spanningCell}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
