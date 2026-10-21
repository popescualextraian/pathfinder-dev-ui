import type { Repository, Task } from '../api/models';
import type { View } from '../state/use-route';
import { Button } from './Button';
import type { NavIconName } from './nav-icons';
import { NavItem } from './NavItem';
import { RepositoryList } from './RepositoryList';
import styles from './Sidebar.module.css';

interface Props {
  repositories: Repository[];
  tasks: Task[];
  selectedRepository: string | null;
  onSelectRepository: (repository: string | null) => void;
  onNewTask?: () => void;
  /** The Backlog entry is shown only when the backlog is enabled. */
  backlogEnabled?: boolean;
  /** The Workflows entry is shown only when workflows are on. */
  workflowsEnabled?: boolean;
  /** Number of backlog items, shown as a badge. */
  backlogCount?: number;
  view?: View;
  onSelectView?: (view: View) => void;
}

interface NavEntry {
  id: View;
  label: string;
  icon: NavIconName;
  count?: number;
}

interface NavGroup {
  label: string;
  items: NavEntry[];
}

/** New areas get one entry here, in the group that fits (Work, Automate, Team). Empty groups are dropped. */
function navGroups({ backlogEnabled, workflowsEnabled, backlogCount, tasks }: Props): NavGroup[] {
  const openTasks = tasks.filter((t) => !t.closed).length;
  const groups: NavGroup[] = [
    {
      label: 'Work',
      items: [
        ...(backlogEnabled ? [{ id: 'backlog' as const, label: 'Backlog', icon: 'backlog' as const, count: backlogCount }] : []),
        { id: 'tasks' as const, label: 'Tasks', icon: 'tasks' as const, count: openTasks },
      ],
    },
    {
      label: 'Automate',
      items: [
        ...(workflowsEnabled ? [{ id: 'workflows' as const, label: 'Workflows', icon: 'workflows' as const }] : []),
        // Schedules are always on.
        { id: 'schedules' as const, label: 'Schedules', icon: 'schedules' as const },
      ],
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

export function Sidebar(props: Props) {
  const { repositories, tasks, selectedRepository, onSelectRepository, onNewTask, onSelectView } = props;
  const groups = navGroups(props);
  // A view whose area is off (a stale link, or still loading) is shown as Tasks by the app, so mark Tasks.
  const view = groups.some((g) => g.items.some((e) => e.id === props.view)) ? props.view : 'tasks';
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
      {groups.map((group) => (
        <div key={group.label}>
          <h2 className={styles.kicker}>{group.label}</h2>
          <ul className={styles.nav}>
            {group.items.map((entry) => (
              <li key={entry.id}>
                <NavItem
                  label={entry.label}
                  icon={entry.icon}
                  count={entry.count}
                  active={view === entry.id}
                  onClick={() => onSelectView?.(entry.id)}
                />
                {entry.id === 'tasks' && view === 'tasks' && (
                  <RepositoryList
                    repositories={repositories}
                    tasks={tasks}
                    selected={selectedRepository}
                    onSelect={onSelectRepository}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
