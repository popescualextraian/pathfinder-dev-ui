import type {
  ScheduleInput, ScheduleRecord, ScheduleResult, SchedulePreview, ScheduleSummary, ScheduleWhen,
} from './models';
import { postJson, request } from './http';

const url = (id: string) => `/api/schedules/${encodeURIComponent(id)}`;

/** Oldest first, each with its latest result only. */
export const listSchedules = () => request<ScheduleSummary[]>('/api/schedules');
export const getSchedule = (id: string) => request<ScheduleRecord>(url(id));
/** A 400 carries the broken field in `ApiError.location.field`. */
export const createSchedule = (input: ScheduleInput) => postJson<ScheduleRecord>('/api/schedules', input);
/** Full replace; keeps id, createdAt and results. */
export const replaceSchedule = (id: string, input: ScheduleInput) =>
  request<ScheduleRecord>(url(id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
export const removeSchedule = (id: string) => request<void>(url(id), { method: 'DELETE' });
/** Runs now (also when disabled); the result may be skipped or refused. */
export const runSchedule = (id: string) => postJson<ScheduleResult>(`${url(id)}/run`);
export const previewSchedule = (when: ScheduleWhen) => postJson<SchedulePreview>('/api/schedules/preview', { when });
