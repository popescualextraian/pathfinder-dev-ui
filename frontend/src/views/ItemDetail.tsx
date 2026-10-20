import type { BacklogItem, FileLink } from '../api/models';
import { FileLinksEditor } from './FileLinksEditor';
import styles from './ItemDetail.module.css';

interface Props {
  item: BacklogItem;
  onSaveFileLinks: (id: string, links: FileLink[]) => void | Promise<void>;
  onClose: () => void;
}

export function ItemDetail({ item, onSaveFileLinks, onClose }: Props) {
  return (
    <aside className={styles.detail} aria-label="Item detail">
      <div className={styles.head}>
        <h2 className={styles.title}>
          #{item.id} {item.title}
        </h2>
        <button type="button" className={styles.close} aria-label="Close detail" onClick={onClose}>
          ×
        </button>
      </div>
      <a href={item.url} target="_blank" rel="noreferrer noopener">
        Open in source
      </a>
      <p className={styles.description}>{item.description}</p>
      <FileLinksEditor key={item.id} links={item.fileLinks} onSave={(links) => onSaveFileLinks(item.id, links)} />
    </aside>
  );
}
