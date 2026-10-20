import { useRoute } from './state/use-route';
import { useRepositories } from './state/use-repositories';
import { useState } from 'react';
import { useTask } from './state/use-task';
import { useTasks } from './state/use-tasks';
import { useBacklog } from './state/use-backlog';
import { BoardView } from './views/BoardView';
import { AppShell } from './views/AppShell';
import { FactsPanel } from './views/FactsPanel';
import { NewTaskDialog } from './views/NewTaskDialog';
import { TaskView } from './views/TaskView';
import { Sidebar } from './views/Sidebar';
import { TaskList } from './views/TaskList';

export function App() {
  const route = useRoute();
  const { repositories } = useRepositories();
  const { tasks, allTasks, loading, error, applyTask, removeTask } = useTasks(route.repository);

  const backlog = useBacklog();
  const [creating, setCreating] = useState(false);
  const { task, loading: taskLoading, error: taskError } = useTask(route.taskId, allTasks);

  return (
    <>
      <AppShell
        sidebar={
          <Sidebar
            repositories={repositories}
            tasks={allTasks}
            selectedRepository={route.repository}
            onSelectRepository={route.selectRepository}
            onNewTask={() => setCreating(true)}
            backlogEnabled={backlog.enabled}
            view={route.view}
            onSelectView={route.selectView}
          />
        }
        board={
          route.view === 'backlog' && backlog.enabled ? (
            <BoardView
              lanes={backlog.lanes}
              items={backlog.items}
              me={backlog.me}
              error={backlog.error}
              onMove={(id, to) => void backlog.move(id, to)}
              onSaveFileLinks={backlog.saveFileLinks}
            />
          ) : undefined
        }
        list={
          <TaskList
            tasks={tasks}
            selectedId={route.taskId}
            onSelect={route.selectTask}
            loading={loading}
            error={error}
          />
        }
        main={
          <TaskView
            task={task}
            loading={taskLoading}
            error={taskError}
            onDeleted={() => {
              if (task) removeTask(task.id);
              route.selectTask(null);
            }}
            onTask={applyTask}
          />
        }
        facts={<FactsPanel task={task} />}
      />
      {creating && (
        <NewTaskDialog
          repositories={repositories}
          defaultRepository={route.repository}
          onClose={() => setCreating(false)}
          onStarted={(t) => {
            setCreating(false);
            route.selectTask(t.id);
          }}
        />
      )}
    </>
  );
}
