import { useState } from 'react';
import type { BacklogItem, ItemDraft, ItemPatch, Lane, WorkflowRun, WorkflowRunStep } from '../api/models';
import { BoardLane } from './BoardLane';
import { Button } from './Button';
import { ItemDetail } from './ItemDetail';
import { ItemDialog } from './ItemDialog';
import { ConfirmDialog } from './Dialog';
import { awaitingApproval, isActiveRun, nextStep, type WorkflowBoard } from './workflow-run-view';
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
  /** Selected item from the route; when given the board follows it (else it keeps its own selection). */
  selectedId?: string | null;
  /** Absent when workflows are off: no workflow controls, drags as usual. */
  workflows?: WorkflowBoard;
}

export const DRIVEN_BY_WORKFLOW = 'This card is driven by its workflow';

export function BoardView({ lanes, items, me, error, onMove, onCreate, onUpdate, onSelect, selectedId: routeSelected, workflows }: Props) {
  const [mineOnly, setMineOnly] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const selectedId = routeSelected !== undefined ? routeSelected : ownSelected;
  const [notice, setNotice] = useState<string | null>(null);
  const [continuing, setContinuing] = useState<{ run: WorkflowRun; step: WorkflowRunStep } | null>(null);
  // `true` creates; an item edits.
  const [dialog, setDialog] = useState<true | BacklogItem | null>(null);

  const assignees = [...new Set(items.flatMap((i) => i.assignees))].sort();
  const visible = items.filter(
    (i) => (!mineOnly || i.assignees.includes(me)) && (!assignee || i.assignees.includes(assignee)),
  );
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const select = (id: string | null) => {
    setOwnSelected(id);
    onSelect?.(id);
  };

  // A card with an active run moves only with its workflow: a drop on the next step's lane while it awaits approval
  // asks to continue (the backend then moves the card); any other drop is refused.
  const move = (id: string, laneId: string) => {
    const run = workflows?.runsByItem.get(id);
    if (!run || !isActiveRun(run)) {
      setNotice(null);
      onMove(id, laneId);
      return;
    }
    const next = nextStep(run);
    if (awaitingApproval(run) && next && next.stage === laneId) {
      setNotice(null);
      setContinuing({ run, step: next });
    } else {
      setNotice(DRIVEN_BY_WORKFLOW);
    }
  };

  return (
    <div className={styles.board}>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
          <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
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
              onMove={move}
              workflows={workflows}
            />
          ))}
        </div>
        {selected && (
          <ItemDetail
            item={selected}
            onEdit={() => setDialog(selected)}
            onClose={() => select(null)}
            workflows={workflows}
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
      {continuing && workflows && (
        <ConfirmDialog
          title={`Continue the workflow to ${continuing.step.title}?`}
          message={`#${continuing.run.itemId} ${continuing.run.definition.title}`}
          confirmLabel="Continue"
          onCancel={() => setContinuing(null)}
          onConfirm={() => {
            const runId = continuing.run.id;
            setContinuing(null);
            void workflows.advance(runId);
          }}
        />
      )}
    </div>
  );
}
