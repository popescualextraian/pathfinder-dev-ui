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
  /** What the task is for; absent for ordinary tasks. */
  kind?: TaskKind;
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

export type TaskKind = 'workflow-generator';

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
}

export interface WorkflowSummary {
  id: string;
  title: string;
  steps: WorkflowStepSummary[];
  doneStage?: string;
  /** Of the file as listed: a delete with it fails (409) when the file changed since. */
  version?: string;
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

/** One step: one prompt in one conversation (session) of the task. */
export interface WorkflowStepDef {
  /** Generated from the title by the editor; never shown. */
  id: string;
  title: string;
  stage?: string;
  prompt: string;
  /** Not with `continue` (the conversation keeps its model). */
  model?: string;
  /** Id of an earlier step: this step goes on in that step's conversation. */
  continue?: string;
  /** Id of an earlier step: this step starts as a copy of that step's conversation. */
  fork?: string;
  gate: WorkflowGate;
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
  /** Set instead of stepId when the step's id is empty or missing. */
  stepIndex?: number;
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
export interface WorkflowRunStep extends WorkflowStepDef {
  /** Only on runs saved before one-session steps: the session the step used; wins over the derived name. */
  session?: string;
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
