import { useRoute } from './state/use-route';
import { useRepositories } from './state/use-repositories';
import { useState, type ReactNode } from 'react';
import { useTask } from './state/use-task';
import { useTasks } from './state/use-tasks';
import { useBacklog } from './state/use-backlog';
import { useWorkflows } from './state/use-workflows';
import { useWorkflowRuns } from './state/use-workflow-runs';
import type { WorkflowBoard } from './views/workflow-run-view';
import { BoardView } from './views/BoardView';
import { AppShell } from './views/AppShell';
import { FactsPanel } from './views/FactsPanel';
import { NewTaskDialog } from './views/NewTaskDialog';
import { TaskView } from './views/TaskView';
import { Sidebar } from './views/Sidebar';
import { TaskList } from './views/TaskList';
import { WorkflowList } from './views/WorkflowList';
import { WorkflowEditorPage } from './WorkflowEditorPage';
import { WorkflowGenerationsSection } from './WorkflowGenerationsSection';
import { SchedulesPage } from './SchedulesPage';

export function App() {
  const route = useRoute();
  const { repositories } = useRepositories();
  const { tasks, allTasks, loading, error, applyTask, removeTask } = useTasks(route.repository);

  const backlog = useBacklog();
  const workflows = useWorkflows();
  // Workflows drive backlog cards: without the board there is nothing to show them on.
  const workflowsOn = workflows.enabled && backlog.enabled;
  const runs = useWorkflowRuns(workflowsOn);
  const workflowBoard: WorkflowBoard | undefined = workflowsOn
    ? {
        definitions: workflows.definitions,
        ready: runs.loaded && !runs.error,
        runsByItem: runs.runsByItem,
        actionState: runs.actionState,
        start: runs.start,
        advance: runs.advance,
        stop: runs.stop,
      }
    : undefined;
  const [creating, setCreating] = useState(false);
  /** A notice for the saved workflow it names (shown in its editor only). */
  const [editorNotice, setEditorNotice] = useState<{ workflow: string; text: string } | null>(null);
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
            backlogCount={backlog.enabled ? backlog.items.length : undefined}
            view={route.view}
            onSelectView={route.selectView}
            workflowsEnabled={workflowsOn}
          />
        }
        board={
          route.view === 'schedules' ? (
            <SchedulesPage
              schedule={route.schedule}
              edit={route.scheduleEdit}
              repositories={repositories}
              onSelect={route.selectSchedule}
            />
          ) : route.view === 'workflows' && workflowsOn ? (
            route.workflow ? (
              <WorkflowEditorPage
                key={`${route.workflow}:${route.from ?? ''}:${route.generation ?? ''}`}
                workflow={route.workflow}
                from={route.from}
                generation={route.generation}
                notice={editorNotice?.workflow === route.workflow ? editorNotice.text : null}
                onNotice={(workflow, text) => setEditorNotice({ workflow, text })}
                lanes={backlog.lanes}
                writable={workflows.writable}
                onClose={() => {
                  setEditorNotice(null);
                  void workflows.reload();
                  route.selectWorkflow(null);
                }}
                onSaved={(id) => {
                  void workflows.reload();
                  route.selectWorkflow(id);
                }}
              />
            ) : (
              (() => {
                const list = (slots?: { button: ReactNode; panels: ReactNode }) => (
                  <WorkflowList
                    definitions={workflows.definitions}
                    refused={workflows.refused}
                    writable={workflows.writable}
                    onNew={() => route.selectWorkflow('new')}
                    onEdit={(id) => route.selectWorkflow(id)}
                    onDuplicate={(id) => route.selectWorkflow('new', id)}
                    onDelete={workflows.remove}
                    onDeleteRefused={workflows.removeRefused}
                    headerActions={slots?.button}
                    generations={slots?.panels}
                  />
                );
                return workflows.writable ? <WorkflowGenerationsSection>{list}</WorkflowGenerationsSection> : list();
              })()
            )
          ) : route.view === 'backlog' && backlog.enabled ? (
            <BoardView
              lanes={backlog.lanes}
              items={backlog.items}
              me={backlog.me}
              error={backlog.error ?? workflows.error ?? runs.error}
              onMove={(id, to) => void backlog.move(id, to)}
              onCreate={backlog.create}
              onUpdate={backlog.update}
              selectedId={route.item}
              onSelect={route.selectItem}
              workflows={workflowBoard}
              workflowsPending={workflows.loading || workflows.error !== null}
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
            session={route.session}
            onSelectSession={route.selectSession}
            workflowRun={workflowsOn && task ? runs.runByTask(task.id) : undefined}
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
