export type NavIconName = 'backlog' | 'tasks' | 'workflows' | 'schedules' | 'architect';

const PATHS: Record<NavIconName, string> = {
  backlog: 'M4 6h16M4 12h16M4 18h10',
  tasks: 'M8 5l11 7-11 7z',
  workflows: 'M5 7h9m0 0l-3-3m3 3l-3 3M19 17H10m0 0l3-3m-3 3l3 3',
  // A clock.
  schedules: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2',
  // A building with columns.
  architect: 'M3 21h18M5 21V10m4 11V10m6 11V10m4 11V10M3 10l9-6 9 6z',
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
