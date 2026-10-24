import { repoNameOf } from '../../commons/repo-name';
import { SessionRecord, TaskRecord } from '../repository/task-record.repository';
import type { TaskCost, TaskKind } from '../repository/task-record.repository';
import { BridgeQuestion, BridgeSession, BridgeStatus } from './bridge-client';

// What clients see of a task: the record without the tokens, plus state from the bridge.
export type TaskSection = 'needs-you' | 'working' | 'in-review' | 'done';

export const MAIN_SESSION = 'main';

// main always exists; other names must be in the record's session list (absent in older records: only main).
export function hasSession(record: TaskRecord, name: string): boolean {
  return name === MAIN_SESSION || (record.sessions ?? []).some((s) => s.name === name);
}

// An open question with the session that asked it (main for older bridges).
export type ViewQuestion = BridgeQuestion & { session: string };

export interface SessionView {
  name: string;
  model?: string;
  state: string;
  reason?: string;
  forkOf?: string;
  createdAt: string;
  lastMessage?: string;
  lastMessageAt?: string;
  // Open questions of this session.
  questions: number;
}

export interface TaskView {
  id: string;
  title: string;
  prompt: string;
  repository: string;
  repoUrl: string;
  repoRef?: string;
  model?: string;
  kind?: TaskKind;
  // Set when a schedule started the task.
  scheduleId?: string;
  scheduleTitle?: string;
  // A scheduled run that ended: the first line of its result.md.
  summaryLine?: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  state: string;
  reason?: string;
  // Where the task belongs in the UI, computed from state and `closed`.
  section: TaskSection;
  // Open questions only.
  questions: ViewQuestion[];
  // Sessions in creation order; always at least main.
  sessions: SessionView[];
  // The whole last agent message (final), as the poller saw it.
  lastMessage?: string;
  lastMessageAt?: string;
  // The bridge's summary, cut to 300 characters: a fallback for lastMessage.
  summary?: string;
  closed: boolean;
  closedAt?: string;
  cost?: TaskCost;
  // The names of the apps whose ports the container published (the record's appPorts): what a suspended
  // task, whose apps cannot be listed, offers to start.
  appNames?: string[];
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

export const MAX_SUMMARY_LINE_LENGTH = 200;

// The first non-blank line of a scheduled run's result.md, trimmed, at most 200 characters ('' when none).
export function summaryLineOf(text: string): string {
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  return line.length <= MAX_SUMMARY_LINE_LENGTH ? line : `${line.slice(0, MAX_SUMMARY_LINE_LENGTH - 1).trimEnd()}…`;
}

// True when two views differ in anything but the time of the last write.
export function viewsDiffer(a: TaskView, b: TaskView): boolean {
  return JSON.stringify({ ...a, updatedAt: '' }) !== JSON.stringify({ ...b, updatedAt: '' });
}

export interface Live {
  state?: string;
  reason?: string;
  questions?: BridgeQuestion[];
  sessions?: BridgeSession[];
  summary?: string;
  branch?: string;
}

// The recorded sessions updated from the bridge's list: bridge fields win, last messages stay.
export function mergeSessions(known: SessionRecord[] | undefined, fromBridge: BridgeSession[]): SessionRecord[] {
  const byName = new Map((known ?? []).map((s) => [s.name, s]));
  const merged = fromBridge.map((b): SessionRecord => {
    const old = byName.get(b.name);
    byName.delete(b.name);
    const s: SessionRecord = { name: b.name, state: b.state, createdAt: b.created };
    if (b.model) s.model = b.model;
    if (b.reason) s.reason = b.reason;
    if (b.fork_of) s.forkOf = b.fork_of;
    if (old?.lastMessage !== undefined) s.lastMessage = old.lastMessage;
    if (old?.lastMessageAt !== undefined) s.lastMessageAt = old.lastMessageAt;
    return s;
  });
  // Known sessions the bridge did not list (cannot happen with a real bridge) are kept.
  return [...merged, ...byName.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
    questions: closed ? [] : (live.questions ?? last.questions ?? []).map((q) => ({ ...q, session: q.session ?? MAIN_SESSION })),
    sessions: [],
    closed,
  };
  // The bridge's task state is running while any session runs; a question in another session still needs you.
  if (view.section !== 'done' && view.questions.length > 0) view.section = 'needs-you';
  if (record.closedAt !== undefined) view.closedAt = record.closedAt;
  if (record.cost !== undefined) view.cost = record.cost;
  if (record.lastMessage !== undefined) view.lastMessage = record.lastMessage;
  if (record.lastMessageAt !== undefined) view.lastMessageAt = record.lastMessageAt;
  if (record.repoRef !== undefined) view.repoRef = record.repoRef;
  if (record.model !== undefined) view.model = record.model;
  if (record.kind !== undefined) view.kind = record.kind;
  if (record.scheduleId !== undefined) view.scheduleId = record.scheduleId;
  if (record.scheduleTitle !== undefined) view.scheduleTitle = record.scheduleTitle;
  if (record.summaryLine) view.summaryLine = record.summaryLine;
  const appNames = record.appPorts ? Object.keys(record.appPorts) : [];
  if (appNames.length) view.appNames = appNames;
  const reason = live.reason ?? last.reason;
  if (reason !== undefined) view.reason = reason;
  const summary = live.summary ?? last.summary;
  if (summary !== undefined) view.summary = summary;
  view.sessions = sessionViews(record, view, live);
  return view;
}

function sessionViews(record: TaskRecord, view: TaskView, live: Live): SessionView[] {
  const known = live.sessions ? mergeSessions(record.sessions, live.sessions) : record.sessions;
  const count = (name: string): number => view.questions.filter((q) => q.session === name).length;
  // A task that is not alive (stopped, suspended, ...) has no running session, whatever the record last saw.
  const alive = ['starting', 'running', 'waiting', 'idle'].includes(view.state);
  const stateOf = (s: SessionRecord): string => {
    if (view.closed) return 'stopped';
    return !alive && ['starting', 'running', 'waiting'].includes(s.state) ? view.state : s.state;
  };
  const from = (s: SessionRecord): SessionView => {
    const v: SessionView = { name: s.name, state: stateOf(s), createdAt: s.createdAt, questions: count(s.name) };
    if (s.model !== undefined) v.model = s.model;
    if (s.reason !== undefined && !view.closed) v.reason = s.reason;
    if (s.forkOf !== undefined) v.forkOf = s.forkOf;
    if (s.lastMessage !== undefined) v.lastMessage = s.lastMessage;
    if (s.lastMessageAt !== undefined) v.lastMessageAt = s.lastMessageAt;
    return v;
  };
  if (known && known.length > 0) return known.map(from);
  // An older record: the one main session, built from what the record has.
  return [from({
    name: MAIN_SESSION, model: record.model, state: view.state, reason: view.reason, createdAt: record.createdAt,
    lastMessage: record.lastMessage, lastMessageAt: record.lastMessageAt,
  })];
}
