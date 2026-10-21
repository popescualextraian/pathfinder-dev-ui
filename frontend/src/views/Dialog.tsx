import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import styles from './Dialog.module.css';

interface DialogProps {
  /** Heading, also the dialog's accessible name. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** A large panel (for editing long text). */
  wide?: boolean;
  /** Selector of the element that takes the focus when it opens (default: the first button). */
  initialFocus?: string;
}

/** Modal shell like ItemDialog's: portal to body (never inside a draggable card), Escape closes, focus returns. */
export function Dialog({ title, onClose, children, wide, initialFocus = 'button' }: DialogProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>(initialFocus)?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  return createPortal(
    <div className={styles.dialog}>
      <div ref={panel} className={`${styles.panel} ${wide ? styles.wide : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Yes/no question; the cancel button comes first and takes the focus, so a stray Enter does not confirm. */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Dialog title={title} onClose={onCancel}>
      {message && <p className={styles.message}>{message}</p>}
      <div className={styles.actions}>
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

export const dialogStyles = styles;
