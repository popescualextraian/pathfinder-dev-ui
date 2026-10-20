import type { BacklogItem, Lane } from '../api/models';
import styles from './BacklogCard.module.css';

interface Props {
  item: BacklogItem;
  lanes: Lane[];
  selected: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, laneId: string) => void;
}

export function BacklogCard({ item, lanes, selected, onSelect, onMove }: Props) {
  return (
    <div
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <button type="button" className={styles.open} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(item.id)}>
        <span className={styles.head}>
          <span className={styles.id}>#{item.id}</span>
          <span className={styles.title}>{item.title}</span>
        </span>
        {item.assignees.length > 0 && <span className={styles.assignees}>{item.assignees.join(', ')}</span>}
      </button>
      <select
        className={styles.move}
        aria-label={`Move #${item.id} to`}
        value=""
        onChange={(e) => e.target.value && onMove(item.id, e.target.value)}
      >
        <option value="">Move to…</option>
        {lanes
          .filter((l) => l.id !== item.lane)
          .map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
      </select>
    </div>
  );
}
