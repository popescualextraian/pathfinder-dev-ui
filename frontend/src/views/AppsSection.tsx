import type { TaskApp, TaskSection, TaskState } from '../api/models';
import { useTaskApps } from '../state/use-task-apps';
import { Button } from './Button';
import { StatePill } from './StatePill';
import styles from './AppsSection.module.css';

// App states borrow the task pill colours: running -> working, stopped -> done, failed -> needs-you.
const SECTION: Record<TaskApp['state'], TaskSection> = { running: 'working', stopped: 'done', failed: 'needs-you' };

function linkLabel(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return link;
  }
}

/** The apps of a task: state, link, Logs, Restart, Stop or Start. Renders nothing for a task without apps. */
export function AppsSection({ taskId, taskState }: { taskId: string; taskState: TaskState }) {
  const { apps, notice, error, busy, logs, act, toggleLogs } = useTaskApps(taskId, taskState);
  if (notice) return <p className={styles.note}>{notice}</p>;
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
        return (
          <div key={app.name} className={styles.app}>
            <div className={styles.row}>
              <span className={styles.name}>{app.name}</span>
              <StatePill state="running" section={SECTION[app.state]} label={app.state} />
              {app.link && (
                <a className={styles.link} href={app.link} target="_blank" rel="noopener noreferrer">
                  {linkLabel(app.link)}
                </a>
              )}
              {app.state === 'failed' && app.exit_code !== undefined && (
                <span className={styles.note}>exit code {app.exit_code}</span>
              )}
              <span className={styles.actions}>
                <Button disabled={!!working} onClick={() => void toggleLogs(app.name)}>
                  Logs
                </Button>
                {app.state === 'running' ? (
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
