import type { SessionView, TaskSection } from '../api/models';
import { Button } from './Button';
import { StatePill } from './StatePill';
import styles from './SessionTabs.module.css';

interface Props {
  sessions: SessionView[];
  selected: string;
  onSelect: (name: string) => void;
  onAdd: () => void;
  addDisabled: boolean;
}

export function sessionSection(s: SessionView): TaskSection {
  if (s.questions > 0 || s.state === 'waiting') return 'needs-you';
  if (s.state === 'running' || s.state === 'starting') return 'working';
  if (s.state === 'idle') return 'in-review';
  return 'done';
}

export function SessionTabs({ sessions, selected, onSelect, onAdd, addDisabled }: Props) {
  return (
    <div className={styles.bar}>
      <div role="tablist" aria-label="Sessions" className={styles.tabs}>
        {sessions.map((s) => (
          <button
            key={s.name}
            type="button"
            role="tab"
            id={`session-tab-${s.name}`}
            data-testid={`session-tab-${s.name}`}
            aria-selected={s.name === selected}
            className={`${styles.tab} ${s.name === selected ? styles.selected : ''}`}
            onClick={() => onSelect(s.name)}
          >
            <span className={styles.name}>{s.name}</span>
            <StatePill state={s.state} section={sessionSection(s)} />
            {s.questions > 0 && (
              <span className={styles.mark} role="img" aria-label="open question">
                ?
              </span>
            )}
          </button>
        ))}
      </div>
      <Button disabled={addDisabled} onClick={onAdd}>
        + Session
      </Button>
    </div>
  );
}
