import type { ScheduleResult } from './schedule';
import type { ScheduledTaskResult } from './scheduled-tasks';

/** A summary kept in a result is cut to this many characters (result.md itself is read with a 64 KB cap). */
export const MAX_SUMMARY_LENGTH = 64 * 1024;

export const PREVIOUS_RUN_STILL_RUNS = 'the previous run still runs';
export const RUNNING_CAP_REACHED = 'the running cap is reached';
export const TASK_GONE = 'the task is gone';

function cap(text: string): string {
  return text.length > MAX_SUMMARY_LENGTH ? `${text.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : text;
}

/**
 * The result of a run that ended: done = stopped `scheduled-done` with a summary; timeout = stopped `timeout`;
 * failed = anything else (failed, interrupted, stopped by hand, closed, gone) or done without a result.
 * Without result.md the summary is "No summary: <why>" and the last message.
 */
export function completeResult(result: ScheduleResult, ended: ScheduledTaskResult | undefined, endedAt: string): ScheduleResult {
  const done: ScheduleResult = { ...result, endedAt };
  if (ended === undefined) return { ...done, outcome: 'failed', reason: TASK_GONE };

  const text = ended.summary !== null && ended.summary.trim() !== '' ? ended.summary : null;
  const problem = text === null ? (ended.summaryProblem ?? (ended.summary === null ? 'the run wrote no result.md' : 'result.md is empty')) : undefined;
  done.summary = cap(text ?? (ended.lastMessage
    ? `No summary: ${problem}. Last message:\n\n${ended.lastMessage}`
    : `No summary: ${problem}, and no last message.`));

  if (ended.state === 'stopped' && ended.reason === 'timeout') return { ...done, outcome: 'timeout', reason: 'the time limit was reached' };
  if (ended.state === 'stopped' && ended.reason === 'scheduled-done') {
    if (text !== null) return { ...done, outcome: 'done' };
    return { ...done, outcome: 'failed', reason: `the run ended without a result: ${problem}` };
  }
  return { ...done, outcome: 'failed', reason: ended.reason || `the task ended ${ended.state}` };
}
