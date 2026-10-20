export type TaskState =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'idle'
  | 'suspended'
  | 'stopped'
  | 'failed'
  | 'interrupted';
export type TaskSection = 'needs-you' | 'working' | 'in-review' | 'done';

export interface Repository {
  name: string;
  url: string;
  default: boolean;
}

export interface TaskQuestion {
  id: string;
  source: 'permission' | 'ask';
  text: string;
  options: string[];
  recommendation: string | null;
  asked: string;
}

export interface Task {
  id: string;
  title: string;
  prompt: string;
  repository: string;
  repoUrl: string;
  repoRef?: string;
  model?: string;
  branch: string;
  state: TaskState;
  reason?: string;
  section: TaskSection;
  questions: TaskQuestion[];
  lastMessage?: string;
  lastMessageAt?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  closed: boolean;
  closedAt?: string;
}

export interface StartTaskRequest {
  prompt: string;
  title?: string;
  repository?: string;
  repoUrl?: string;
  repoRef?: string;
  model?: string;
}

export interface AnswerRequest {
  text: string;
  question?: string;
}

export type BridgeEventType = 'state' | 'message' | 'tool' | 'plan' | 'question' | 'answer' | 'gate' | 'error';

export interface BridgeEvent {
  seq: number;
  ts: string;
  task: string;
  session: string;
  agent: string;
  type: BridgeEventType;
  data: Record<string, unknown>;
}

export interface FileLink {
  repo: string;
  path: string;
  ref?: string;
  note?: string;
}

export interface Lane {
  id: string;
  title: string;
}

export interface BacklogItem {
  id: string;
  title: string;
  description: string;
  lane: string;
  assignees: string[];
  url: string;
  fileLinks: FileLink[];
  updatedAt: string;
}

export interface ItemDraft {
  title: string;
  description?: string;
  lane?: string;
}

export interface ItemPatch {
  title?: string;
  description?: string;
  /** Usernames; an empty list unassigns everyone. */
  assignees?: string[];
}

export interface LanesResponse {
  me: string;
  lanes: Lane[];
}
