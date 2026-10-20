import type { ReactNode } from 'react';
import { SystemInfoView } from './SystemInfoView';
import styles from './AppShell.module.css';

interface Props {
  sidebar?: ReactNode;
  list?: ReactNode;
  main?: ReactNode;
  facts?: ReactNode;
  /** When set, replaces the list, main and facts columns (the backlog board). */
  board?: ReactNode;
}

export function AppShell({ sidebar, list, main, facts, board }: Props) {
  return (
    <div className={styles.shell}>
      <div className={styles.columns}>
        <nav className={styles.sidebar} aria-label="Repositories">
          {sidebar}
        </nav>
        {board !== undefined ? (
          <main className={styles.main}>{board}</main>
        ) : (
          <>
            <section className={styles.list} aria-label="Tasks">
              {list}
            </section>
            <main className={styles.main}>{main}</main>
            <aside className={styles.facts} aria-label="Facts">
              {facts}
            </aside>
          </>
        )}
      </div>
      <footer className={styles.footer}>
        <SystemInfoView />
      </footer>
    </div>
  );
}
