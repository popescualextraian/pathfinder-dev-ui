import { Cron } from 'croner';
import type { When } from './schedule';

export const AT_FORMAT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Offset of the zone from UTC at an instant, in minutes.
function offsetMinutes(instant: number, zone: string): number {
  const name = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instant)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name);
  if (!match || !match[1]) return 0;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The instant as an ISO string in the zone with its offset, e.g. 2026-10-22T22:00:00+03:00 (seconds kept, no millis). */
export function formatInZone(date: Date, zone: string): string {
  const offset = offsetMinutes(date.getTime(), zone);
  const local = new Date(Math.floor(date.getTime() / 1000) * 1000 + offset * 60000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${local.getUTCFullYear().toString().padStart(4, '0')}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
    + `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The instant of a local time 'YYYY-MM-DDTHH:mm' in the zone (a time skipped or repeated by DST resolves to one of the two readings). */
export function zonedToInstant(local: string, zone: string): Date {
  const m = AT_FORMAT.exec(local);
  if (!m) throw new Error('Invalid local time');
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const first = guess - offsetMinutes(guess, zone) * 60000;
  const second = guess - offsetMinutes(first, zone) * 60000;
  return new Date(second);
}

/** Next `count` firings strictly after `now` as ISO strings with the zone offset. A past `at` has none. */
export function previewNext(when: When, zone: string, now: Date, count = 3): string[] {
  if (when.at !== undefined) {
    const at = zonedToInstant(when.at, zone);
    return at.getTime() > now.getTime() ? [formatInZone(at, zone)] : [];
  }
  return new Cron(when.cron, { timezone: zone }).nextRuns(count, now).map((d) => formatInZone(d, zone));
}

/** The next firing after `now`, or null. */
export function nextRunAt(when: When, zone: string, now: Date): string | null {
  return previewNext(when, zone, now, 1)[0] ?? null;
}
