import type { BacklogItem } from '../api/models';
import styles from './ItemDetail.module.css';

interface Props {
  item: BacklogItem;
  onEdit: () => void;
  onClose: () => void;
}

export function ItemDetail({ item, onEdit, onClose }: Props) {
  return (
    <aside className={styles.detail} aria-label="Item detail">
      <div className={styles.head}>
        <h2 className={styles.title}>
          #{item.id} {item.title}
        </h2>
        <button type="button" className={styles.edit} onClick={onEdit}>
          Edit
        </button>
        <button type="button" className={styles.close} aria-label="Close detail" onClick={onClose}>
          ×
        </button>
      </div>
      <a href={item.url} target="_blank" rel="noreferrer noopener">
        Open in source
      </a>
      <p className={styles.description}>{item.description}</p>
    </aside>
  );
}
