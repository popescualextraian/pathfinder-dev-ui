import type { ChangeKind } from '../api/models';
import { CHANGE_LABEL, CHANGE_SIGN } from './architecture-layout';
import styles from './ChangeMark.module.css';

/** The sign of a change (`+ ~ −`) in its colour, spoken as "new component" etc. */
export function ChangeMark({ change }: { change: ChangeKind }) {
  return (
    <span role="img" aria-label={CHANGE_LABEL[change]} className={`${styles.mark} ${styles[change]}`} data-change={change}>
      {CHANGE_SIGN[change]}
    </span>
  );
}
