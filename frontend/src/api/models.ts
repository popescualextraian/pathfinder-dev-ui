export type TaskState =
  'starting' | 'running' | 'waiting' | 'idle' | 'suspended' | 'stopped' | 'failed' | 'interrupted';
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
  /** Session the question belongs to. */
  session: string;
}

export interface SessionView {
  name: string;
  model?: string;
  state: TaskState;
  reason?: string;
  forkOf?: string;
  createdAt: string;
  lastMessage?: string;
  lastMessageAt?: string;
  /** Number of open questions. */
  questions: number;
}

export interface AddSessionRequest {
  name: string;
  model?: string;
  forkFrom?: string;
  prompt?: string;
}

export interface TaskCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  usd: { estimate?: number; billedCredits?: number; unknown?: number };
  sessions: number;
  snapshotAt: string;
  readAt: string;
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
  sessions: SessionView[];
  lastMessage?: string;
  lastMessageAt?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  closed: boolean;
  closedAt?: string;
  cost?: TaskCost;
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
  session?: string;
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

export type WorkflowGate = 'human' | 'auto';

export interface WorkflowStepSummary {
  id: string;
  title: string;
  stage?: string;
  gate: WorkflowGate;
  /** Session names. */
  sessions: string[];
}

export interface WorkflowSummary {
  id: string;
  title: string;
  steps: WorkflowStepSummary[];
  doneStage?: string;
}

export interface RefusedWorkflow {
  file: string;
  error: string;
  /** For deleting the file; absent when it could not be read. */
  version?: string;
}

export interface WorkflowList {
  definitions: WorkflowSummary[];
  refused: RefusedWorkflow[];
  /** False when the definitions folder is read-only. */
  writable: boolean;
}

export interface WorkflowSessionDef {
  name: string;
  prompt: string;
  fork?: string;
  model?: string;
}

export interface WorkflowStepDef {
  id: string;
  title: string;
  stage?: string;
  gate: WorkflowGate;
  sessions: WorkflowSessionDef[];
  requires?: string[];
  exitPrompt?: string;
}

/** The full definition (with prompts), as the editor reads and writes it. */
export interface WorkflowDefinition {
  title: string;
  steps: WorkflowStepDef[];
  doneStage?: string;
}

export interface StoredWorkflow {
  definition: WorkflowDefinition & { id?: string };
  /** Of the file content; sent back on update and delete. */
  version: string;
}

/** Where a definition rule was broken. */
export interface WorkflowErrorLocation {
  stepId?: string;
  session?: string;
  field?: string;
}

export interface WorkflowValidationError extends WorkflowErrorLocation {
  message: string;
}

export type WorkflowRunState =
  | 'running'
  | 'needs-you'
  | 'awaiting-approval'
  | 'blocked'
  | 'done'
  | 'stopped'
  | 'failed';
export type WorkflowRunPhase = 'sessions' | 'exit' | 'awaiting-approval' | 'blocked';
export type WorkflowRunSessionStatus = 'pending' | 'running' | 'done';

/** The step as the run view carries it (the definition as the run started, with prompts). */
export interface WorkflowRunStep {
  id: string;
  title: string;
  stage?: string;
  gate: WorkflowGate;
  sessions: Array<{ name: string; prompt: string; fork?: string; model?: string }>;
  requires?: string[];
  exitPrompt?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  definition: { id: string; title: string; steps: WorkflowRunStep[]; doneStage?: string };
  itemId: string;
  item: { id: string; title: string; description: string; url: string; stage: string };
  taskId: string;
  stepIndex: number;
  phase: WorkflowRunPhase;
  sessions: Record<string, { status: WorkflowRunSessionStatus }>;
  state: WorkflowRunState;
  warning?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}
