import type { BacklogItem } from '../api/models';
import { WorkflowControls } from './WorkflowControls';
import type { WorkflowBoard } from './workflow-run-view';
import styles from './ItemDetail.module.css';

interface Props {
  item: BacklogItem;
  onEdit: () => void;
  onClose: () => void;
  workflows?: WorkflowBoard;
}

export function ItemDetail({ item, onEdit, onClose, workflows }: Props) {
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
      {workflows && <WorkflowControls item={item} workflows={workflows} showSteps />}
      <p className={styles.description}>{item.description}</p>
    </aside>
  );
}
