import { TaskRecord, TaskRecordRepository } from '../repository/task-record.repository';
import { TaskInspection, TaskLauncher } from './task-launcher';
import { summaryLineOf } from './task-view';

// States in which a task's bridge is (or should be) alive.
export const LIVE_STATES: ReadonlySet<string> = new Set(['starting', 'running', 'waiting', 'idle']);

/** Whether the record says the task's bridge is (or should be) alive: not closed, not stopped, in a live state. */
export function recordedLive(record: TaskRecord): boolean {
  return !record.closed && LIVE_STATES.has(record.lastState ?? 'starting');
}
// States the bridge writes into state.json when it ends (or suspends) on purpose.
const END_STATES = new Set(['stopped', 'failed', 'suspended', 'interrupted']);

/** A scheduled run is over once its task is closed or left the live states (normally stopped, `scheduled-done` or `timeout`). */
export function scheduledRunEnded(record: TaskRecord): boolean {
  return record.scheduled !== undefined && (record.closed === true || !LIVE_STATES.has(record.lastState ?? 'starting'));
}

/** Whether the run's summary line is still to be read: a scheduled run that ended and has none yet. */
export function needsSummaryLine(record: TaskRecord): boolean {
  return scheduledRunEnded(record) && record.summaryLine === undefined;
}

/** The first line of result.md, or '' when it is missing or unreadable (never throws). */
export async function readSummaryLine(launcher: Pick<TaskLauncher, 'readTaskFile'>, id: string): Promise<string> {
  try {
    const text = await launcher.readTaskFile(id, 'result.md');
    return text === null ? '' : summaryLineOf(text);
  } catch {
    return '';
  }
}

/**
 * State and reason of a task whose bridge is gone (container exited or bridge process ended), from the
 * bridge's own state.json. A live state left there (the bridge was killed) counts as interrupted, as the
 * bridge itself would call it on its next boot; no state.json at all, or a container that is gone, is failed.
 */
export async function endedState(launcher: Pick<TaskLauncher, 'readTaskFile'>, id: string, exists: boolean): Promise<{ state: string; reason: string }> {
  if (!exists) return { state: 'failed', reason: 'the task ended and its container is gone' };
  let text: string | null;
  try {
    text = await launcher.readTaskFile(id, 'state.json');
  } catch (error) {
    return { state: 'failed', reason: `the task ended and its state.json could not be read: ${error instanceof Error ? error.message : 'unknown error'}` };
  }
  if (text === null) return { state: 'failed', reason: 'the task ended without a state: its bridge wrote no state.json' };
  let parsed: { state?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(text) as { state?: unknown; reason?: unknown };
  } catch {
    return { state: 'failed', reason: 'the task ended and its state.json is not valid JSON' };
  }
  const state = typeof parsed.state === 'string' ? parsed.state : '';
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
  if (END_STATES.has(state)) return { state, reason };
  if (state === '') return { state: 'failed', reason: 'the task ended and its state.json names no state' };
  return { state: 'interrupted', reason: `the bridge ended while the task was ${state} (without stop or suspension)` };
}

export interface GoneEnd {
  /** The record as it was when the end was written (or refused). */
  before: TaskRecord;
  /** The record after the write; the same object as `before` when the write was refused. */
  updated: TaskRecord;
  /** False when a stop, close or other change that left the live states came in meanwhile and won. */
  applied: boolean;
  end: { state: string; reason: string };
}

/**
 * Records the end of a task whose bridge is gone (container exited or local bridge process ended) with the state
 * its state.json gives, and the summary line of a scheduled run. Undefined when the container still runs (nothing
 * written). Only a record still in a live state (starting, running, waiting, idle) is moved: a stop, close or
 * other end that came in meanwhile wins. The caller announces the change.
 */
export async function recordGoneEnd(
  records: Pick<TaskRecordRepository, 'update'>,
  launcher: Pick<TaskLauncher, 'inspect' | 'readTaskFile'>,
  armRecheck: () => Partial<TaskRecord>,
  id: string,
  known?: TaskInspection,
): Promise<GoneEnd | undefined> {
  const inspection = known ?? await launcher.inspect(id);
  if (inspection.exists && inspection.running) return undefined;
  const end = await endedState(launcher, id, inspection.exists);
  let before: TaskRecord | undefined;
  let applied = false;
  let updated = await records.update(id, (current) => {
    before = current;
    if (!recordedLive(current)) return undefined;
    applied = true;
    return {
      lastState: end.state,
      lastStatus: { ...(current.lastStatus as object | undefined), state: end.state, reason: end.reason, questions: [] },
      ...armRecheck(),
    };
  });
  if (needsSummaryLine(updated)) {
    const summaryLine = await readSummaryLine(launcher, id);
    updated = await records.update(id, (current) => (current.summaryLine === undefined ? { summaryLine } : undefined));
  }
  return { before: before ?? updated, updated, applied, end };
}
