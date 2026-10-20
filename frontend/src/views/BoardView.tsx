import { useState } from 'react';
import type { BacklogItem, ItemDraft, ItemPatch, Lane } from '../api/models';
import { BoardLane } from './BoardLane';
import { Button } from './Button';
import { ItemDetail } from './ItemDetail';
import { ItemDialog } from './ItemDialog';
import styles from './BoardView.module.css';

interface Props {
  lanes: Lane[];
  items: BacklogItem[];
  me: string;
  error?: string | null;
  onMove: (id: string, laneId: string) => void;
  onCreate: (draft: ItemDraft) => Promise<unknown>;
  onUpdate: (id: string, patch: ItemPatch) => Promise<unknown>;
  onSelect?: (id: string | null) => void;
}

export function BoardView({ lanes, items, me, error, onMove, onCreate, onUpdate, onSelect }: Props) {
  const [mineOnly, setMineOnly] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // `true` creates; an item edits.
  const [dialog, setDialog] = useState<true | BacklogItem | null>(null);

  const assignees = [...new Set(items.flatMap((i) => i.assignees))].sort();
  const visible = items.filter(
    (i) => (!mineOnly || i.assignees.includes(me)) && (!assignee || i.assignees.includes(assignee)),
  );
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const select = (id: string | null) => {
    setSelectedId(id);
    onSelect?.(id);
  };

  return (
    <div className={styles.board}>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.filters}>
        <label className={styles.check}>
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          My items
        </label>
        <label className={styles.check}>
          Assignee
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">All</option>
            {assignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" className={styles.add} onClick={() => setDialog(true)}>
          New item
        </Button>
      </div>
      <div className={styles.body}>
        <div className={styles.lanes}>
          {lanes.map((lane) => (
            <BoardLane
              key={lane.id}
              lane={lane}
              items={visible.filter((i) => i.lane === lane.id)}
              selectedId={selectedId}
              laneOf={(id) => items.find((i) => i.id === id)?.lane ?? null}
              onSelect={select}
              onMove={onMove}
            />
          ))}
        </div>
        {selected && (
          <ItemDetail
            item={selected}
            onEdit={() => setDialog(selected)}
            onClose={() => select(null)}
          />
        )}
      </div>
      {dialog && (
        <ItemDialog
          lanes={lanes}
          item={dialog === true ? undefined : dialog}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
