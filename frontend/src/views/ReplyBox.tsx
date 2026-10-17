import { useState } from 'react';
import styles from './TaskView.module.css';

interface Props {
  disabled: boolean;
  stopped?: boolean;
  pending: boolean;
  error: string | null;
  /** Resolves true when the text was sent (the box then clears). */
  onSend: (text: string) => Promise<boolean>;
}

export function ReplyBox({ disabled, stopped, pending, error, onSend }: Props) {
  const [text, setText] = useState('');
  const send = async () => {
    if (disabled || pending || !text.trim()) return;
    if (await onSend(text.trim())) setText('');
  };
  return (
    <div className={styles.reply}>
      <div className={styles.row}>
        <textarea
          aria-label="Follow-up"
          placeholder={
            disabled ? (stopped ? 'This task is stopped' : 'This task is closed') : 'Send a follow-up to this task…'
          }
          rows={2}
          value={text}
          disabled={disabled || pending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className={styles.send}
          aria-label="Send"
          disabled={disabled || pending || !text.trim()}
          onClick={() => void send()}
        >
          ➤
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
