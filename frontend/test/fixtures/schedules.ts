import type { ScheduleRecord, ScheduleResult, ScheduleSummary } from '../../src/api/models';

export function makeResult(over: Partial<ScheduleResult> = {}): ScheduleResult {
  return { firedAt: '2026-10-21T23:00:00.000Z', trigger: 'time', outcome: 'done', taskId: 'T-9', branch: 'agentic/T-9', ...over };
}

const base = {
  id: 'nightly',
  title: 'Nightly deps',
  prompt: 'Update the dependencies.\nPush a branch.',
  repository: 'repo-a',
  when: { cron: '0 2 * * 1-5' },
  timeoutMinutes: 120,
  enabled: true,
  nextRunAt: '2026-10-22T02:00:00+00:00',
  zone: 'UTC',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
};

export const makeSummary = (over: Partial<ScheduleSummary> = {}): ScheduleSummary => ({ ...base, ...over });
export const makeRecord = (over: Partial<ScheduleRecord> = {}): ScheduleRecord => ({ ...base, results: [], ...over });
