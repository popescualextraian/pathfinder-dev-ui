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
  /** The Tasks / Backlog switch is shown only when the backlog is enabled. */
  backlogEnabled?: boolean;
  /** The Workflows entry is shown only when workflows are on. */
  workflowsEnabled?: boolean;
  view?: 'tasks' | 'backlog' | 'workflows';
  onSelectView?: (view: 'tasks' | 'backlog' | 'workflows') => void;
}

export function Sidebar({
  repositories,
  tasks,
  selectedRepository,
  onSelectRepository,
  onNewTask,
  backlogEnabled = false,
  workflowsEnabled = false,
  view = 'tasks',
  onSelectView,
}: Props) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          &gt;_
        </span>
        <span className={styles.brandName}>pathfinder</span>
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
      {backlogEnabled ? (
        <ul className={styles.show}>
          {(workflowsEnabled ? (['tasks', 'backlog', 'workflows'] as const) : (['tasks', 'backlog'] as const)).map((v) => (
            <li key={v}>
              <button
                type="button"
                className={styles.switch}
                aria-current={view === v ? 'true' : undefined}
                onClick={() => onSelectView?.(v)}
              >
                {v === 'tasks' ? 'Tasks' : v === 'backlog' ? 'Backlog' : 'Workflows'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className={styles.show}>
          <li aria-current="true">Tasks</li>
        </ul>
      )}
    </div>
  );
}
