import { useState } from 'react';
import type { BacklogItem, Lane } from '../api/models';
import { BacklogCard } from './BacklogCard';
import styles from './BoardLane.module.css';

interface Props {
  lane: Lane;
  lanes: Lane[];
  items: BacklogItem[];
  selectedId: string | null;
  /** Current lane of a dragged item; null when unknown. */
  laneOf: (id: string) => string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, laneId: string) => void;
}

export function BoardLane({ lane, lanes, items, selectedId, laneOf, onSelect, onMove }: Props) {
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
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/plain');
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
          <BacklogCard key={item.id} item={item} lanes={lanes} selected={item.id === selectedId} onSelect={onSelect} onMove={onMove} />
        ))}
      </div>
    </section>
  );
}
