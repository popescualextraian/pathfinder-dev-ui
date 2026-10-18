import type { Task } from '../api/models';
import { formatAgo } from './format-age';
import { formatCost } from './format-cost';
import styles from './FactsPanel.module.css';

export function FactsPanel({ task }: { task: Task | null }) {
  if (!task) return null;
  const rows: [string, string, boolean?][] = [
    ['State', task.closed ? `${task.state} (closed)` : task.state],
    ['Repository', task.repository],
    ['Branch', task.branch, true],
    ['Task id', task.id, true],
    ['Model', task.model ?? 'default'],
    ['Started', formatAgo(task.createdAt)],
    ['Last activity', formatAgo(task.lastMessageAt ?? task.updatedAt)],
  ];
  const cost = task.cost && formatCost(task.cost);
  return (
    <dl className={styles.facts}>
      {rows.map(([k, v, mono]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={mono ? styles.mono : undefined}>{v}</dd>
        </div>
      ))}
      <div>
        <dt>Cost</dt>
        <dd>
          {cost ? cost.usd : '—'}
          {cost && <small className={styles.sub}>{cost.tokens}</small>}
        </dd>
      </div>
    </dl>
  );
}
