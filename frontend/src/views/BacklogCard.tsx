import type { BacklogItem } from '../api/models';
import styles from './BacklogCard.module.css';

/** Private drag type: a lane accepts only drags that started on a card, never dropped text. */
export const ITEM_MIME = 'application/x-pathfinder-item';

interface Props {
  item: BacklogItem;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function BacklogCard({ item, selected, onSelect }: Props) {
  const description = item.description.trim();
  return (
    <div
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(ITEM_MIME, item.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <button type="button" className={styles.open} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(item.id)}>
        <span className={styles.head}>
          <span className={styles.id}>#{item.id}</span>
          <span className={styles.title}>{item.title}</span>
        </span>
        {description && <span className={styles.description}>{description}</span>}
        {item.assignees.length > 0 && <span className={styles.assignees}>{item.assignees.join(', ')}</span>}
      </button>
    </div>
  );
}
