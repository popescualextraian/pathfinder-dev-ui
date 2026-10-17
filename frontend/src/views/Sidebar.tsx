import type { Repository, Task } from '../api/models';
import { Button } from './Button';
import { RepositoryList } from './RepositoryList';
import styles from './Sidebar.module.css';

interface Props {
  repositories: Repository[];
  tasks: Task[];
  selectedRepository: string | null;
  onSelectRepository: (repository: string | null) => void;
  onNewTask?: () => void;
}

export function Sidebar({ repositories, tasks, selectedRepository, onSelectRepository, onNewTask }: Props) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          &gt;_
        </span>
        <span className={styles.brandName}>agentic</span>
      </div>
      <div className={styles.newTask}>
        <Button variant="primary" onClick={onNewTask}>
          + New task
        </Button>
      </div>
      <RepositoryList
        repositories={repositories}
        tasks={tasks}
        selected={selectedRepository}
        onSelect={onSelectRepository}
      />
      <h2 className={styles.kicker}>Show</h2>
      <ul className={styles.show}>
        <li aria-current="true">Tasks</li>
      </ul>
    </div>
  );
}
