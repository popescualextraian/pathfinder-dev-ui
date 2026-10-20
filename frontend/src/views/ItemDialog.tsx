import { useEffect, useRef, useState } from 'react';
import type { BacklogItem, ItemDraft, ItemPatch, Lane } from '../api/models';
import { Button } from './Button';
import styles from './ItemDialog.module.css';

interface Props {
  lanes: Lane[];
  /** Edits this item; without it the dialog creates one. */
  item?: BacklogItem;
  onCreate: (draft: ItemDraft) => Promise<unknown>;
  onUpdate: (id: string, patch: ItemPatch) => Promise<unknown>;
  onClose: () => void;
}

const names = (text: string) => text.split(',').map((n) => n.trim()).filter(Boolean);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((n, i) => n === b[i]);

export function ItemDialog({ lanes, item, onCreate, onUpdate, onClose }: Props) {
  const first = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [lane, setLane] = useState(lanes[0]?.id ?? '');
  const [assignees, setAssignees] = useState(item?.assignees.join(', ') ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const opener = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => {
      alive.current = false;
      opener?.focus?.();
    };
  }, []);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      if (item) {
        const patch: ItemPatch = {};
        if (trimmed !== item.title) patch.title = trimmed;
        if (description !== item.description) patch.description = description;
        const wanted = names(assignees);
        if (!same(wanted, item.assignees)) patch.assignees = wanted;
        if (Object.keys(patch).length > 0) await onUpdate(item.id, patch);
      } else {
        await onCreate({ title: trimmed, ...(description && { description }), ...(lane && { lane }) });
      }
      onClose();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setPending(false);
    }
  };

  const heading = item ? `Edit item #${item.id}` : 'New item';
  return (
    <div className={styles.dialog}>
      <form
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-dialog-heading"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="item-dialog-heading">{heading}</h2>
        <label className={styles.field}>
          Title
          <input ref={first} value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className={styles.field}>
          Description
          <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {item ? (
          <label className={styles.field}>
            Assignees
            <input value={assignees} placeholder="usernames, comma separated" onChange={(e) => setAssignees(e.target.value)} />
          </label>
        ) : (
          <label className={styles.field}>
            Lane
            <select value={lane} onChange={(e) => setLane(e.target.value)}>
              {lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending || !title.trim()}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
