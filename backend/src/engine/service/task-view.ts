import { repoNameOf } from '../../commons/repo-name';
import { TaskRecord } from '../repository/task-record.repository';
import { TaskCost } from './task-cost';
import { BridgeQuestion, BridgeStatus } from './bridge-client';

// What clients see of a task: the record without the tokens, plus state from the bridge.
export type TaskSection = 'needs-you' | 'working' | 'in-review' | 'done';

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
  // Where the task belongs in the UI, computed from state and `closed`.
  section: TaskSection;
  // Open questions only.
  questions: BridgeQuestion[];
  // The whole last agent message (final), as the poller saw it.
  lastMessage?: string;
  lastMessageAt?: string;
  // The bridge's summary, cut to 300 characters: a fallback for lastMessage.
  summary?: string;
  closed: boolean;
  closedAt?: string;
  cost?: TaskCost;
}

// closed or stopped: done; waiting, failed, interrupted: needs you; idle, suspended: in review; the rest is working.
export function sectionOf(state: string, closed: boolean): TaskSection {
  if (closed || state === 'stopped') return 'done';
  if (state === 'waiting' || state === 'failed' || state === 'interrupted') return 'needs-you';
  if (state === 'idle' || state === 'suspended') return 'in-review';
  return 'working';
}

export const MAX_TITLE_LENGTH = 80;

// The given title, or the first non-blank line of the prompt: trimmed, at most 80 characters.
export function titleFrom(prompt: string, given?: string): string {
  const source = given?.trim() || prompt.split('\n').find((line) => line.trim() !== '')?.trim() || '';
  const line = source.replace(/\s+/g, ' ');
  return line.length <= MAX_TITLE_LENGTH ? line : `${line.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

// True when two views differ in anything but the time of the last write.
export function viewsDiffer(a: TaskView, b: TaskView): boolean {
  return JSON.stringify({ ...a, updatedAt: '' }) !== JSON.stringify({ ...b, updatedAt: '' });
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
  const closed = record.closed === true;
  const state = closed ? 'stopped' : (live.state ?? record.lastState ?? 'starting');
  const view: TaskView = {
    id: record.id,
    title: record.title ?? titleFrom(record.prompt),
    prompt: record.prompt,
    repository: record.repository ?? repoNameOf(record.repoUrl),
    repoUrl: record.repoUrl,
    branch: live.branch ?? record.branch,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    state,
    section: sectionOf(state, closed),
    questions: closed ? [] : (live.questions ?? last.questions ?? []),
    closed,
  };
  if (record.closedAt !== undefined) view.closedAt = record.closedAt;
  if (record.cost !== undefined) view.cost = record.cost;
  if (record.lastMessage !== undefined) view.lastMessage = record.lastMessage;
  if (record.lastMessageAt !== undefined) view.lastMessageAt = record.lastMessageAt;
  if (record.repoRef !== undefined) view.repoRef = record.repoRef;
  if (record.model !== undefined) view.model = record.model;
  const reason = live.reason ?? last.reason;
  if (reason !== undefined) view.reason = reason;
  const summary = live.summary ?? last.summary;
  if (summary !== undefined) view.summary = summary;
  return view;
}
