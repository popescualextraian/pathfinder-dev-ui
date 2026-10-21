import type { ScheduleWhen } from '../api/models';

export type RepeatPreset = 'daily' | 'weekdays' | 'weekly' | 'custom';

/** The form's "When" fields; `formToWhen` makes the schedule's `when` of them. */
export interface WhenForm {
  mode: 'once' | 'repeat';
  /** Once: YYYY-MM-DD. */
  date: string;
  /** HH:mm, for once and the presets. */
  time: string;
  preset: RepeatPreset;
  /** Weekly: 0 = Sunday .. 6 = Saturday. */
  day: number;
  /** Custom: the five-field cron line. */
  cron: string;
}

export const DEFAULT_WHEN_FORM: WhenForm = { mode: 'repeat', date: '', time: '09:00', preset: 'daily', day: 1, cron: '' };

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: string | number) => String(n).padStart(2, '0');
const AT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/** A cron line one of the presets writes, read back; null for anything else. */
function readPreset(cron: string): { preset: Exclude<RepeatPreset, 'custom'>; time: string; day: number } | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-7])$/.exec(cron.trim());
  if (!m || Number(m[1]) > 59 || Number(m[2]) > 23) return null;
  const time = `${pad(Number(m[2]))}:${pad(Number(m[1]))}`;
  if (m[3] === '*') return { preset: 'daily', time, day: DEFAULT_WHEN_FORM.day };
  if (m[3] === '1-5') return { preset: 'weekdays', time, day: DEFAULT_WHEN_FORM.day };
  return { preset: 'weekly', time, day: Number(m[3]) % 7 };
}

/** A schedule's time in words; the cron line itself when it is not a daily, weekdays or weekly time. */
export function describeWhen(when: ScheduleWhen): string {
  if ('at' in when) {
    const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(when.at);
    return m ? `once on ${Number(m[2])} ${MONTHS[Number(m[1]) - 1]} ${m[3]}:${m[4]}` : when.at;
  }
  const p = readPreset(when.cron);
  if (!p) return when.cron;
  if (p.preset === 'daily') return `daily at ${p.time}`;
  if (p.preset === 'weekdays') return `weekdays at ${p.time}`;
  return `${WEEKDAYS[p.day]}s at ${p.time}`;
}

export function whenToForm(when: ScheduleWhen | undefined): WhenForm {
  if (!when) return DEFAULT_WHEN_FORM;
  if ('at' in when) {
    const m = AT.exec(when.at);
    return { ...DEFAULT_WHEN_FORM, mode: 'once', date: m?.[1] ?? '', time: m?.[2] ?? '' };
  }
  const p = readPreset(when.cron);
  return p ? { ...DEFAULT_WHEN_FORM, ...p } : { ...DEFAULT_WHEN_FORM, preset: 'custom', cron: when.cron };
}

/** The cron line of a preset at a time (HH:mm); null without a time. */
export function presetCron(preset: Exclude<RepeatPreset, 'custom'>, time: string, day: number): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const head = `${Number(m[2])} ${Number(m[1])} * *`;
  return preset === 'daily' ? `${head} *` : preset === 'weekdays' ? `${head} 1-5` : `${head} ${day}`;
}

/** The `when` the fields describe; null while incomplete. */
export function formToWhen(f: WhenForm): ScheduleWhen | null {
  if (f.mode === 'once') return f.date && /^\d{2}:\d{2}$/.test(f.time) ? { at: `${f.date}T${f.time}` } : null;
  if (f.preset === 'custom') return f.cron.trim() ? { cron: f.cron.trim().replace(/\s+/g, ' ') } : null;
  const cron = presetCron(f.preset, f.time, f.day);
  return cron ? { cron } : null;
}

function parts(at: number, zone: string | undefined, options: Intl.DateTimeFormatOptions): Record<string, string> {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-GB', { ...options, hourCycle: 'h23', timeZone: zone });
  } catch {
    format = new Intl.DateTimeFormat('en-GB', { ...options, hourCycle: 'h23' });
  }
  return Object.fromEntries(format.formatToParts(at).map((p) => [p.type, p.value]));
}

/** "Thu 22 Oct 02:00" in the zone (the browser's when the zone is missing or unknown). */
export function formatTime(iso: string | number, zone?: string): string {
  const p = parts(typeof iso === 'number' ? iso : Date.parse(iso), zone, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}`;
}

/** "02:00" in the zone. */
export function formatClock(at: number, zone?: string): string {
  const p = parts(at, zone, { hour: '2-digit', minute: '2-digit' });
  return `${p.hour}:${p.minute}`;
}

/** "under a minute", "12 min", "1 h 5 min". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}
