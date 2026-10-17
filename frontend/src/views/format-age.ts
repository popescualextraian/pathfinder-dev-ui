export function formatAge(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** "just now", "5 min ago", ... for sentences. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const age = formatAge(iso, now);
  return age === 'now' ? 'just now' : `${age} ago`;
}
