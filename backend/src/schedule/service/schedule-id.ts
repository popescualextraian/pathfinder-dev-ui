export const SCHEDULE_ID = /^[a-z0-9-]{1,40}$/;
export const MAX_SCHEDULE_ID_LENGTH = 40;

const RESERVED = ['new'];

function slug(title: string): string {
  return title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_SCHEDULE_ID_LENGTH).replace(/-+$/, '');
}

/** The id of a title: lowercase words joined by `-` (max 40), unique among `takenIds` (and never `new`) with -2, -3, ...; `schedule-N` when empty. */
export function proposeScheduleId(title: string, takenIds: readonly string[]): string {
  // `new` is the form's route (#/schedules/new), so it is never an id.
  const taken = [...takenIds, ...RESERVED];
  const base = slug(title);
  if (!base) {
    for (let n = 1; ; n++) if (!taken.includes(`schedule-${n}`)) return `schedule-${n}`;
  }
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, MAX_SCHEDULE_ID_LENGTH - suffix.length).replace(/-+$/, '') + suffix;
    if (!taken.includes(candidate)) return candidate;
  }
}
