import type { Repository, Task } from '../api/models';
import styles from './RepositoryList.module.css';

interface Props {
  repositories: Repository[];
  tasks: Task[];
  selected: string | null;
  onSelect: (repository: string | null) => void;
}

export function RepositoryList({ repositories, tasks, selected, onSelect }: Props) {
  const open = tasks.filter((t) => !t.closed);
  const countFor = (name: string) => open.filter((t) => t.repository === name).length;
  const item = (label: string, count: number, value: string | null) => (
    <li key={value ?? '__all'}>
      <button
        type="button"
        className={`${styles.item} ${selected === value ? styles.selected : ''}`}
        aria-current={selected === value ? 'true' : undefined}
        title={label}
        onClick={() => onSelect(value)}
      >
        <span className={styles.name}>{label}</span>
        <span className={styles.count} aria-label={`${count} open tasks`}>
          {count}
        </span>
      </button>
    </li>
  );
  return (
    <ul className={styles.list} aria-label="Repositories">
      {item('All repositories', open.length, null)}
      {repositories.map((r) => item(r.name, countFor(r.name), r.name))}
    </ul>
  );
}
