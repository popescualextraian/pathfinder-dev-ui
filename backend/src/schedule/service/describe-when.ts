import type { When } from './schedule';

const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: string | number) => String(n).padStart(2, '0');

/** A schedule's time in words; the cron line itself when it is not a daily, weekdays or weekly time. */
export function describeWhen(when: When): string {
  if (when.at !== undefined) {
    const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(when.at);
    return m ? `once on ${Number(m[2])} ${MONTHS[Number(m[1]) - 1]} ${m[3]}:${m[4]}` : when.at;
  }
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-7])$/.exec(when.cron.trim());
  if (!m || Number(m[1]) > 59 || Number(m[2]) > 23) return when.cron;
  const time = `${pad(m[2])}:${pad(m[1])}`;
  if (m[3] === '*') return `daily at ${time}`;
  if (m[3] === '1-5') return `weekdays at ${time}`;
  return `${DAYS[Number(m[3]) % 7]} at ${time}`;
}
