import { useState } from 'react';
import type { TaskQuestion } from '../api/models';
import { Button } from './Button';
import styles from './TaskView.module.css';

interface Props {
  question: TaskQuestion;
  pending: boolean;
  /** Task closed or stopped: nothing can be answered. */
  disabled?: boolean;
  error: string | null;
  onAnswer: (text: string, question: string) => void;
}

export function QuestionCard({ question, pending, disabled = false, error, onAnswer }: Props) {
  const off = pending || disabled;
  const [text, setText] = useState('');
  const send = () => text.trim() && onAnswer(text.trim(), question.id);
  return (
    <section className={styles.question} aria-label="Question">
      <h3 className={styles.kicker}>Question</h3>
      <p className={styles.block}>{question.text}</p>
      <div className={styles.options}>
        {question.options.map((o) => (
          <Button key={o} disabled={off} onClick={() => onAnswer(o, question.id)}>
            {o}
            {o === question.recommendation ? ' (recommended)' : ''}
          </Button>
        ))}
      </div>
      <div className={styles.row}>
        <input
          aria-label="Your answer"
          value={text}
          disabled={off}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <Button variant="primary" disabled={off || !text.trim()} onClick={send}>
          Answer
        </Button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
