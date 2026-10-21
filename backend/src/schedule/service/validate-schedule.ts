import { Cron } from 'croner';
import {
  MAX_MODEL_LENGTH, MAX_REF_LENGTH, MAX_TEXT_LENGTH, MAX_TITLE_LENGTH, MODEL_NAME, MODEL_NAME_MESSAGE, REPO_REF,
} from '../../commons/task-input-rules';
import { AT_FORMAT, zonedToInstant } from './schedule-time';
import { DEFAULT_TIMEOUT_MINUTES, MAX_TIMEOUT_MINUTES, MIN_TIMEOUT_MINUTES, ScheduleInput, When } from './schedule';

export interface ScheduleValidationError {
  /** The field, e.g. `title`, `when.cron`, `when.at`, `timeoutMinutes`; `schedule` for the whole body. */
  field: string;
  message: string;
}

export interface ValidateOptions {
  /** Names of the configured repositories. */
  repositories: readonly string[];
  /** SCHEDULES_TIMEZONE. */
  zone: string;
  now: Date;
}

export type ValidateResult = { value: ScheduleInput } | { error: ScheduleValidationError };

const fail = (field: string, message: string): { error: ScheduleValidationError } => ({ error: { field, message } });
const isText = (v: unknown): v is string => typeof v === 'string';
const YEAR_MS = 365 * 24 * 3600 * 1000;

/** Checks a user's schedule; the first error in field order, or the cleaned input with defaults (timeout 120, enabled). */
export function validateSchedule(input: unknown, options: ValidateOptions): ValidateResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail('schedule', 'The schedule must be an object');
  const body = input as Record<string, unknown>;

  // The same limits and characters as the public task API (commons/task-input-rules).
  if (!isText(body.title) || body.title.trim() === '') return fail('title', 'The title is required');
  if (body.title.length > MAX_TITLE_LENGTH) return fail('title', `The title must be at most ${MAX_TITLE_LENGTH} characters`);
  if (!isText(body.prompt) || body.prompt.trim() === '') return fail('prompt', 'The prompt is required');
  if (body.prompt.length > MAX_TEXT_LENGTH) return fail('prompt', `The prompt must be at most ${MAX_TEXT_LENGTH} characters`);
  if (!isText(body.repository) || !options.repositories.includes(body.repository)) {
    return fail('repository', 'The repository must be one of the configured repositories');
  }
  if (body.ref !== undefined && !isText(body.ref)) return fail('ref', 'The ref must be text');
  const ref = isText(body.ref) ? body.ref.trim() : '';
  if (ref.length > MAX_REF_LENGTH) return fail('ref', `The ref must be at most ${MAX_REF_LENGTH} characters`);
  if (ref && !REPO_REF.test(ref)) return fail('ref', 'The ref contains characters that are not allowed (or starts with -)');
  if (body.model !== undefined && !isText(body.model)) return fail('model', 'The model must be text');
  const model = isText(body.model) ? body.model.trim() : '';
  if (model.length > MAX_MODEL_LENGTH) return fail('model', `The model must be at most ${MAX_MODEL_LENGTH} characters`);
  if (model && !MODEL_NAME.test(model)) return fail('model', MODEL_NAME_MESSAGE);

  const when = validateWhen(body.when, options);
  if ('error' in when) return when;

  const timeout = body.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MINUTES || timeout > MAX_TIMEOUT_MINUTES) {
    return fail('timeoutMinutes', `The time limit must be a whole number of minutes from ${MIN_TIMEOUT_MINUTES} to ${MAX_TIMEOUT_MINUTES}`);
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return fail('enabled', 'enabled must be true or false');

  const value: ScheduleInput = {
    title: body.title.trim(), prompt: body.prompt, repository: body.repository, when: when.value,
    timeoutMinutes: timeout, enabled: body.enabled ?? true,
  };
  if (ref) value.ref = ref;
  if (model) value.model = model;
  return { value };
}

/** Checks `when` alone (as in a schedule): field `when`, `when.cron` or `when.at`. */
export function validateWhen(raw: unknown, options: Pick<ValidateOptions, 'zone' | 'now'>): { value: When } | { error: ScheduleValidationError } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('when', 'when is required: { cron } or { at }');
  const { cron, at } = raw as Record<string, unknown>;
  if ((cron === undefined) === (at === undefined)) return fail('when', 'when must have exactly one of cron and at');
  if (cron !== undefined) {
    if (!isText(cron) || cron.trim().split(/\s+/).length !== 5) return fail('when.cron', 'The cron line must have five fields: minute hour day month weekday');
    let next: Date | null;
    try {
      next = new Cron(cron.trim(), { timezone: options.zone }).nextRun(options.now);
    } catch {
      return fail('when.cron', 'The cron line cannot be parsed');
    }
    if (next === null) return fail('when.cron', 'The cron line never fires (no such date)');
    return { value: { cron: cron.trim().split(/\s+/).join(' ') } };
  }
  const m = isText(at) ? AT_FORMAT.exec(at) : null;
  if (!isText(at) || !m) return fail('when.at', 'at must be a local time like 2026-10-22T22:00');
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return fail('when.at', 'at is not a valid date and time');
  const instant = zonedToInstant(at, options.zone).getTime();
  if (instant <= options.now.getTime()) return fail('when.at', 'at must be in the future');
  if (instant > options.now.getTime() + YEAR_MS) return fail('when.at', 'at must be within a year');
  return { value: { at } };
}
