import type { Repository } from './api/models';
import { useSchedule, useSchedules } from './state/use-schedules';
import { Button } from './views/Button';
import { ScheduleDetail } from './views/ScheduleDetail';
import { ScheduleForm } from './views/ScheduleForm';
import { ScheduleList } from './views/ScheduleList';
import styles from './SchedulesPage.module.css';

interface Props {
  /** null: the list; `new`: the form of a new schedule; else a schedule id. */
  schedule: string | null;
  /** With an id: its form instead of its detail. */
  edit: boolean;
  repositories: Repository[];
  /** Goes to a schedule's detail (or its form with `edit`), `new`, or the list (null). */
  onSelect: (schedule: string | null, edit?: boolean) => void;
}

function ListPage({ onSelect }: Pick<Props, 'onSelect'>) {
  const s = useSchedules();
  return (
    <ScheduleList
      schedules={s.schedules}
      loading={s.loading}
      error={s.error}
      pending={s.pending}
      actionError={s.actionError}
      onNew={() => onSelect('new')}
      onEdit={(id) => onSelect(id, true)}
      onRun={s.run}
      onToggle={s.toggle}
    />
  );
}

function Missing({ text, onBack }: { text: string; onBack: () => void }) {
  return (
    <div className={styles.state}>
      <p role="alert">{text}</p>
      <Button onClick={onBack}>← All schedules</Button>
    </div>
  );
}

function OnePage({ id, edit, repositories, onSelect }: { id: string } & Omit<Props, 'schedule'>) {
  const s = useSchedule(id);
  if (!s.schedule) {
    if (s.loading) return <p className={styles.state}>Loading schedule…</p>;
    return <Missing text={s.notFound ? `Schedule ${id} was not found.` : `Could not load the schedule: ${s.error}`} onBack={() => onSelect(null)} />;
  }
  if (edit) {
    return (
      <ScheduleForm
        key={s.schedule.id}
        schedule={s.schedule}
        repositories={repositories}
        onSaved={(saved) => {
          void s.reload();
          onSelect(saved);
        }}
        onCancel={() => onSelect(id)}
      />
    );
  }
  return (
    <ScheduleDetail
      schedule={s.schedule}
      pending={s.pending}
      actionError={s.actionError}
      onBack={() => onSelect(null)}
      onEdit={() => onSelect(id, true)}
      onRun={s.run}
      onToggle={s.toggle}
      onDelete={async () => {
        const ok = await s.remove();
        if (ok) onSelect(null);
        return ok;
      }}
    />
  );
}

/** The Schedules screen for one route: list, new, detail or edit. */
export function SchedulesPage({ schedule, edit, repositories, onSelect }: Props) {
  if (schedule === null) return <ListPage onSelect={onSelect} />;
  if (schedule === 'new') {
    return <ScheduleForm repositories={repositories} onSaved={(id) => onSelect(id)} onCancel={() => onSelect(null)} />;
  }
  return <OnePage key={schedule} id={schedule} edit={edit} repositories={repositories} onSelect={onSelect} />;
}
