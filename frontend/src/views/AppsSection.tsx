import type { TaskApp, TaskSection, TaskState } from '../api/models';
import { useTaskApps } from '../state/use-task-apps';
import { Button } from './Button';
import { StatePill } from './StatePill';
import styles from './AppsSection.module.css';

// App states borrow the task pill colours: running and preparing -> working, stopped -> done,
// exited and failed -> needs-you.
const SECTION: Record<TaskApp['state'], TaskSection> = {
  running: 'working',
  preparing: 'working',
  stopped: 'done',
  exited: 'needs-you',
  failed: 'needs-you',
};

function linkLabel(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return link;
  }
}

interface Props {
  taskId: string;
  taskState: TaskState;
  /** The app names of the task record: offered with Start while the task is suspended. */
  appNames?: string[];
}

/** The apps of a task: state, link, Logs, Restart, Stop or Start. Renders nothing for a task without apps. */
export function AppsSection({ taskId, taskState, appNames = [] }: Props) {
  const { apps, notice, suspended, error, busy, logs, act, toggleLogs } = useTaskApps(taskId, taskState);
  if (notice) return <p className={styles.note}>{notice}</p>;
  if (suspended && apps.length === 0 && appNames.length > 0) {
    return (
      <section className={styles.apps} aria-label="Apps">
        <h3 className={styles.kicker}>Apps</h3>
        <p className={styles.note}>Task is suspended — Start wakes it</p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {appNames.map((name) => (
          <div key={name} className={styles.app}>
            <div className={styles.row}>
              <span className={styles.name}>{name}</span>
              <span className={styles.actions}>
                <Button disabled={!!busy[name]} onClick={() => void act(name, 'start')}>
                  Start
                </Button>
              </span>
            </div>
          </div>
        ))}
      </section>
    );
  }
  if (apps.length === 0 && !error) return null;
  return (
    <section className={styles.apps} aria-label="Apps">
      <h3 className={styles.kicker}>Apps</h3>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {apps.map((app) => {
        const working = busy[app.name];
        const shown = logs[app.name];
        const ended = app.state === 'failed' || app.state === 'exited';
        return (
          <div key={app.name} className={styles.app}>
            <div className={styles.row}>
              <span className={styles.name}>{app.name}</span>
              <StatePill state="running" section={SECTION[app.state] ?? 'working'} label={app.state} />
              {app.link && (
                <a className={styles.link} href={app.link} target="_blank" rel="noopener noreferrer">
                  {linkLabel(app.link)}
                </a>
              )}
              {ended && typeof app.exit_code === 'number' && <span className={styles.note}>exit code {app.exit_code}</span>}
              <span className={styles.actions}>
                <Button disabled={!!working} onClick={() => void toggleLogs(app.name)}>
                  Logs
                </Button>
                {app.state === 'preparing' ? (
                  <span className={styles.note}>preparing…</span>
                ) : app.state === 'running' ? (
                  <>
                    <Button disabled={!!working} onClick={() => void act(app.name, 'restart')}>
                      Restart
                    </Button>
                    <Button disabled={!!working} onClick={() => void act(app.name, 'stop')}>
                      Stop
                    </Button>
                  </>
                ) : (
                  <Button disabled={!!working} onClick={() => void act(app.name, 'start')}>
                    Start
                  </Button>
                )}
              </span>
            </div>
            {shown && <pre className={styles.logs}>{shown.join('\n')}</pre>}
          </div>
        );
      })}
    </section>
  );
}
