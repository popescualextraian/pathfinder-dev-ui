import { repoNameOf } from '../../commons/repo-name';
import { TaskRecord } from '../../repository/tasks/task-record.repository';
import { BridgeQuestion, BridgeStatus } from './bridge-client';

// What clients see of a task: the record without the tokens, plus state from the bridge.
export interface TaskView {
  id: string;
  title: string;
  prompt: string;
  repository: string;
  repoUrl: string;
  repoRef?: string;
  model?: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  state: string;
  reason?: string;
  questions: BridgeQuestion[];
  summary?: string;
}

export const MAX_TITLE_LENGTH = 80;

// The given title, or the first non-blank line of the prompt: trimmed, at most 80 characters.
export function titleFrom(prompt: string, given?: string): string {
  const source = given?.trim() || prompt.split('\n').find((line) => line.trim() !== '')?.trim() || '';
  const line = source.replace(/\s+/g, ' ');
  return line.length <= MAX_TITLE_LENGTH ? line : `${line.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export interface Live {
  state?: string;
  reason?: string;
  questions?: BridgeQuestion[];
  summary?: string;
  branch?: string;
}

// Built field by field so a token can never slip into a view.
export function toView(record: TaskRecord, live: Live = {}): TaskView {
  const last = (record.lastStatus ?? {}) as Partial<BridgeStatus>;
  const view: TaskView = {
    id: record.id,
    title: record.title ?? titleFrom(record.prompt),
    prompt: record.prompt,
    repository: record.repository ?? repoNameOf(record.repoUrl),
    repoUrl: record.repoUrl,
    branch: live.branch ?? record.branch,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    state: live.state ?? record.lastState ?? 'starting',
    questions: live.questions ?? last.questions ?? [],
  };
  if (record.repoRef !== undefined) view.repoRef = record.repoRef;
  if (record.model !== undefined) view.model = record.model;
  const reason = live.reason ?? last.reason;
  if (reason !== undefined) view.reason = reason;
  const summary = live.summary ?? last.summary;
  if (summary !== undefined) view.summary = summary;
  return view;
}
