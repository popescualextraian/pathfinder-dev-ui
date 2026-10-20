import { useState } from 'react';
import type { FileLink } from '../api/models';
import { Button } from './Button';
import styles from './FileLinksEditor.module.css';

interface Props {
  links: FileLink[];
  onSave: (links: FileLink[]) => void | Promise<void>;
}

const clean = (rows: FileLink[]): FileLink[] =>
  rows.map((r) => {
    const out: FileLink = { repo: r.repo.trim(), path: r.path.trim() };
    if (r.ref?.trim()) out.ref = r.ref.trim();
    if (r.note?.trim()) out.note = r.note.trim();
    return out;
  });

export function FileLinksEditor({ links, onSave }: Props) {
  const [rows, setRows] = useState<FileLink[]>(links);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (i: number, key: keyof FileLink, value: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: value } : row)));
  const invalid = rows.some((r) => !r.repo.trim() || !r.path.trim());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(clean(rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.editor}>
      <h3 className={styles.heading}>File links</h3>
      {rows.map((row, i) => (
        <div className={styles.row} key={i} role="group" aria-label={`File link ${i + 1}`}>
          <input aria-label={`Repo ${i + 1}`} placeholder="repo" value={row.repo} onChange={(e) => change(i, 'repo', e.target.value)} />
          <input aria-label={`Path ${i + 1}`} placeholder="path" value={row.path} onChange={(e) => change(i, 'path', e.target.value)} />
          <input aria-label={`Ref ${i + 1}`} placeholder="ref (optional)" value={row.ref ?? ''} onChange={(e) => change(i, 'ref', e.target.value)} />
          <input aria-label={`Note ${i + 1}`} placeholder="note (optional)" value={row.note ?? ''} onChange={(e) => change(i, 'note', e.target.value)} />
          <Button aria-label={`Remove link ${i + 1}`} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <div className={styles.actions}>
        <Button onClick={() => setRows((r) => [...r, { repo: '', path: '' }])}>Add link</Button>
        <Button variant="primary" disabled={invalid || saving} onClick={() => void save()}>
          Save
        </Button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
