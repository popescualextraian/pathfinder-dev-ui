import { useState } from 'react';
import type { TaskQuestion } from '../api/models';
import { Button } from './Button';
import styles from './TaskView.module.css';

interface Props {
  question: TaskQuestion;
  pending: boolean;
  error: string | null;
  onAnswer: (text: string, question: string) => void;
}

export function QuestionCard({ question, pending, error, onAnswer }: Props) {
  const [text, setText] = useState('');
  const send = () => text.trim() && onAnswer(text.trim(), question.id);
  return (
    <section className={styles.question} aria-label="Question">
      <h3 className={styles.kicker}>Question</h3>
      <p className={styles.block}>{question.text}</p>
      <div className={styles.options}>
        {question.options.map((o) => (
          <Button key={o} disabled={pending} onClick={() => onAnswer(o, question.id)}>
            {o}
            {o === question.recommendation ? ' (recommended)' : ''}
          </Button>
        ))}
      </div>
      <div className={styles.row}>
        <input
          aria-label="Your answer"
          value={text}
          disabled={pending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <Button variant="primary" disabled={pending || !text.trim()} onClick={send}>
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
