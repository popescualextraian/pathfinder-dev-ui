import { useRoute } from './state/use-route';
import { useRepositories } from './state/use-repositories';
import { useTasks } from './state/use-tasks';
import { AppShell } from './views/AppShell';
import { Sidebar } from './views/Sidebar';
import { TaskList } from './views/TaskList';

export function App() {
  const route = useRoute();
  const { repositories } = useRepositories();
  const { tasks, allTasks, loading, error } = useTasks(route.repository);

  return (
    <AppShell
      sidebar={
        <Sidebar
          repositories={repositories}
          tasks={allTasks}
          selectedRepository={route.repository}
          onSelectRepository={route.selectRepository}
        />
      }
      list={
        <TaskList tasks={tasks} selectedId={route.taskId} onSelect={route.selectTask} loading={loading} error={error} />
      }
      main={<p>Select a task</p>}
      facts={null}
    />
  );
}
