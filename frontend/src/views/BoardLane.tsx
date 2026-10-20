import { useState } from 'react';
import type { BacklogItem, Lane } from '../api/models';
import { BacklogCard, ITEM_MIME } from './BacklogCard';
import type { WorkflowBoard } from './workflow-run-view';
import styles from './BoardLane.module.css';

interface Props {
  lane: Lane;
  items: BacklogItem[];
  selectedId: string | null;
  /** Current lane of a dragged item; null when unknown. */
  laneOf: (id: string) => string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, laneId: string) => void;
  workflows?: WorkflowBoard;
}

export function BoardLane({ lane, items, selectedId, laneOf, onSelect, onMove, workflows }: Props) {
  const [over, setOver] = useState(false);
  return (
    <section
      className={`${styles.lane} ${over ? styles.over : ''}`}
      aria-label={lane.title}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData(ITEM_MIME);
        const from = id ? laneOf(id) : null;
        if (id && from !== null && from !== lane.id) onMove(id, lane.id);
      }}
    >
      <h2 className={styles.header}>
        <span>{lane.title}</span>
        <span className={styles.count} aria-label={`${items.length} items`}>
          {items.length}
        </span>
      </h2>
      <div className={styles.cards}>
        {items.map((item) => (
          <BacklogCard
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onSelect={onSelect}
            workflows={workflows}
          />
        ))}
      </div>
    </section>
  );
}
