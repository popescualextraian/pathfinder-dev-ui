import { NavIcon, type NavIconName } from './nav-icons';
import styles from './NavItem.module.css';

interface Props {
  label: string;
  icon: NavIconName;
  active: boolean;
  count?: number;
  onClick: () => void;
}

export function NavItem({ label, icon, active, count, onClick }: Props) {
  return (
    <button
      type="button"
      className={`${styles.item} ${active ? styles.active : ''}`}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
    >
      <span className={styles.icon}>
        <NavIcon name={icon} />
      </span>
      <span className={styles.label}>{label}</span>
      {count !== undefined && (
        <span className={styles.count} aria-hidden="true">
          {count}
        </span>
      )}
    </button>
  );
}
