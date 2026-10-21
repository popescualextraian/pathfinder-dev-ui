import { useMemo, useState } from 'react';
import type { Repository, ScheduleInput, ScheduleRecord } from '../api/models';
import { useLeaveGuard } from '../state/use-route';
import { PREVIEW_DELAY_MS, useSchedulePreview, useScheduleSave } from '../state/use-schedule-form';
import { Button } from './Button';
import { ConfirmDialog } from './Dialog';
import {
  DEFAULT_WHEN_FORM, WEEKDAYS, formToWhen, formatTime, presetCron, whenToForm, type RepeatPreset, type WhenForm,
} from './schedule-when';
import styles from './ScheduleForm.module.css';

export const DEFAULT_TIMEOUT_MINUTES = 120;

interface Props {
  /** The schedule to edit; absent for a new one. */
  schedule?: ScheduleRecord;
  repositories: Repository[];
  onSaved: (id: string) => void;
  onCancel: () => void;
  previewDelay?: number;
}

interface Fields {
  title: string;
  repository: string;
  ref: string;
  model: string;
  prompt: string;
  when: WhenForm;
  timeout: string;
}

/** `repository` '' stands for the default one (the repositories may load after the form opens). */
function initialFields(schedule: ScheduleRecord | undefined): Fields {
  if (schedule) {
    return {
      title: schedule.title,
      repository: schedule.repository,
      ref: schedule.ref ?? '',
      model: schedule.model ?? '',
      prompt: schedule.prompt,
      when: whenToForm(schedule.when),
      timeout: String(schedule.timeoutMinutes),
    };
  }
  return {
    title: '',
    repository: '',
    ref: '',
    model: '',
    prompt: '',
    when: DEFAULT_WHEN_FORM,
    timeout: String(DEFAULT_TIMEOUT_MINUTES),
  };
}

function toInput(f: Fields, repository: string, enabled: boolean): ScheduleInput | null {
  const when = formToWhen(f.when);
  if (!when) return null;
  const input: ScheduleInput = {
    title: f.title.trim(),
    prompt: f.prompt.trim(),
    repository,
    when,
    timeoutMinutes: Number(f.timeout),
    enabled,
  };
  if (f.ref.trim()) input.ref = f.ref.trim();
  if (f.model.trim()) input.model = f.model.trim();
  return input;
}

const PRESETS: { value: RepeatPreset; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom (cron)' },
];

/** The form of a new or an existing schedule: saves through the API, asks before unsaved changes are left. */
export function ScheduleForm({ schedule, repositories, onSaved, onCancel, previewDelay = PREVIEW_DELAY_MS }: Props) {
  const initial = useMemo(() => initialFields(schedule), [schedule]);
  const [fields, setFields] = useState<Fields>(initial);
  const [asking, setAsking] = useState(false);
  const enabled = schedule?.enabled ?? true;
  const save = useScheduleSave();

  const when = formToWhen(fields.when);
  const preview = useSchedulePreview(when, previewDelay);
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);
  const guard = useLeaveGuard(dirty);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((f) => ({ ...f, [key]: value }));
  const setWhen = (patch: Partial<WhenForm>) => setFields((f) => ({ ...f, when: { ...f.when, ...patch } }));
  const choosePreset = (preset: RepeatPreset) =>
    setFields((f) => {
      const cron = f.when.preset !== 'custom' && preset === 'custom' ? presetCron(f.when.preset, f.when.time, f.when.day) : null;
      return { ...f, when: { ...f.when, preset, ...(cron && !f.when.cron.trim() ? { cron } : {}) } };
    });

  const invalid = (name: string) => (save.field === name || save.field?.startsWith(`${name}.`) ? true : undefined);
  const repository = fields.repository || repositories.find((r) => r.default)?.name || repositories[0]?.name || '';
  const repositoryNames = repositories.map((r) => r.name);
  if (repository && !repositoryNames.includes(repository)) repositoryNames.push(repository);

  const submit = async () => {
    const input = toInput(fields, repository, enabled);
    if (!input || save.pending) return;
    const saved = await save.save(schedule?.id ?? null, input);
    if (saved) {
      guard.release();
      onSaved(saved.id);
    }
  };
  const cancel = () => {
    if (dirty) setAsking(true);
    else {
      guard.release();
      onCancel();
    }
  };
  const leaving = guard.pending !== null;

  return (
    <form
      className={styles.form}
      aria-label={schedule ? 'Edit schedule' : 'New schedule'}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <header className={styles.header}>
        <h1>{schedule ? 'Edit schedule' : 'New schedule'}</h1>
        <div className={styles.buttons}>
          <Button onClick={cancel}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={save.pending || !when}>
            Save
          </Button>
        </div>
      </header>
      {save.error && (
        <p className={styles.error} role="alert">
          {save.error}
        </p>
      )}
      <div className={styles.body}>
        <label className={styles.field}>
          Title
          <input value={fields.title} aria-invalid={invalid('title')} onChange={(e) => set('title', e.target.value)} />
        </label>
        <div className={styles.row}>
          <label className={styles.field}>
            Repository
            <select value={repository} aria-invalid={invalid('repository')} onChange={(e) => set('repository', e.target.value)}>
              {repositoryNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Ref (optional)
            <input value={fields.ref} placeholder="default branch" aria-invalid={invalid('ref')} onChange={(e) => set('ref', e.target.value)} />
          </label>
          <label className={styles.field}>
            Model (optional)
            <input value={fields.model} aria-invalid={invalid('model')} onChange={(e) => set('model', e.target.value)} />
          </label>
        </div>
        <label className={styles.field}>
          Prompt
          <textarea rows={10} value={fields.prompt} aria-invalid={invalid('prompt')} onChange={(e) => set('prompt', e.target.value)} />
        </label>
        <p className={styles.note}>
          Nobody answers questions during a scheduled run: say in the prompt what to do and where to put the result (push a branch,
          open a pull request).
        </p>

        <fieldset className={styles.group}>
          <legend>When</legend>
          <div className={styles.modes}>
            <label>
              <input type="radio" name="schedule-mode" checked={fields.when.mode === 'once'} onChange={() => setWhen({ mode: 'once' })} />
              Once
            </label>
            <label>
              <input type="radio" name="schedule-mode" checked={fields.when.mode === 'repeat'} onChange={() => setWhen({ mode: 'repeat' })} />
              Repeat
            </label>
          </div>
          <div className={styles.row}>
            {fields.when.mode === 'once' ? (
              <label className={styles.field}>
                Date
                <input type="date" value={fields.when.date} aria-invalid={invalid('when')} onChange={(e) => setWhen({ date: e.target.value })} />
              </label>
            ) : (
              <label className={styles.field}>
                Repeats
                <select value={fields.when.preset} onChange={(e) => choosePreset(e.target.value as RepeatPreset)}>
                  {PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {fields.when.mode === 'repeat' && fields.when.preset === 'weekly' && (
              <label className={styles.field}>
                On
                <select value={fields.when.day} onChange={(e) => setWhen({ day: Number(e.target.value) })}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {fields.when.mode === 'repeat' && fields.when.preset === 'custom' ? (
              <label className={styles.field}>
                Cron line
                <input
                  className={styles.mono}
                  value={fields.when.cron}
                  placeholder="minute hour day month weekday"
                  aria-invalid={invalid('when')}
                  onChange={(e) => setWhen({ cron: e.target.value })}
                />
              </label>
            ) : (
              <label className={styles.field}>
                At
                <input type="time" value={fields.when.time} aria-invalid={invalid('when')} onChange={(e) => setWhen({ time: e.target.value })} />
              </label>
            )}
          </div>
          {preview.error ? (
            <p className={styles.previewError}>{preview.error}</p>
          ) : (
            when && (
              <p className={styles.preview} data-testid="schedule-next-runs">
                Next runs:{' '}
                {preview.next.length > 0
                  ? preview.next.map((t) => formatTime(t, preview.zone ?? undefined)).join(' · ')
                  : preview.loading
                    ? '…'
                    : 'none'}
                {preview.zone && <span className={styles.zone}> ({preview.zone})</span>}
              </p>
            )
          )}
        </fieldset>

        <label className={`${styles.field} ${styles.narrow}`}>
          Time limit (minutes)
          <input
            type="number"
            min={1}
            max={1440}
            value={fields.timeout}
            aria-invalid={invalid('timeoutMinutes')}
            aria-describedby="schedule-timeout-help"
            onChange={(e) => set('timeout', e.target.value)}
          />
        </label>
        <p id="schedule-timeout-help" className={styles.help}>
          The agent is asked for its summary when the time is up.
        </p>
      </div>
      {(asking || leaving) && (
        <ConfirmDialog
          title="Discard your changes?"
          message="The schedule has changes that are not saved."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          danger
          onConfirm={() => {
            setAsking(false);
            if (leaving) guard.proceed();
            else {
              guard.release();
              onCancel();
            }
          }}
          onCancel={() => {
            setAsking(false);
            guard.stay();
          }}
        />
      )}
    </form>
  );
}
