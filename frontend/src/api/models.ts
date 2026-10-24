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
  /** Set when a schedule started the task. */
  scheduleId?: string;
  scheduleTitle?: string;
  /** A scheduled run that ended: the first line of its result.md. */
  summaryLine?: string;
  /** Names of the task's apps from its record: shown with Start while the task is suspended. */
  appNames?: string[];
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

/** `preparing`: the app's prepare step runs; `exited`: the app ended on its own (see exit_code). */
export type AppState = 'running' | 'preparing' | 'stopped' | 'exited' | 'failed';

export interface TaskApp {
  name: string;
  state: AppState;
  ports: number[];
  url: string;
  /** Unix seconds of the last state change, null when unknown. */
  since?: number | null;
  exit_code?: number | null;
  /** http://localhost:<hostPort><url>, null without a published port. */
  link: string | null;
}

export type BridgeEventType = 'state' | 'message' | 'tool' | 'plan' | 'question' | 'answer' | 'gate' | 'error' | 'app';

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

/** `task`: a plain task linked to the item (no workflow; `definition` has no steps). Absent: a workflow run. */
export type WorkflowRunKind = 'task';

/** Body of `POST /api/workflow-runs/task` besides the item. */
export interface TaskRunInput {
  prompt: string;
  title?: string;
  model?: string;
  repository?: string;
}

export interface WorkflowRun {
  id: string;
  kind?: WorkflowRunKind;
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

export type WorkflowGenerationState = 'writing' | 'asking' | 'fixing' | 'ready' | 'failed' | 'saved' | 'discarded';

export interface WorkflowGenerationQuestion {
  id: string;
  /** Session the question belongs to (the generator's `main`). */
  session: string;
  text: string;
  options: string[];
  recommendation?: string | null;
  asked: string;
}

/** One generation of a workflow by an agent. `draft` is only on the full view (ready: a valid definition; failed: the last parsed mapping). */
export interface WorkflowGenerationView {
  id: string;
  taskId: string;
  description: string;
  model?: string;
  state: WorkflowGenerationState;
  /** Fixes sent in the current round. */
  attempts: number;
  draft?: WorkflowDefinition | Record<string, unknown>;
  errors?: WorkflowValidationError[];
  failureReason?: string;
  warning?: string;
  question?: WorkflowGenerationQuestion;
  lastMessage?: string;
  cost?: TaskCost;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export type WorkflowGenerationSummary = Omit<WorkflowGenerationView, 'draft'> & { hasDraft: boolean };

export type ScheduleWhen = { cron: string } | { at: string };
export type ScheduleOutcome = 'running' | 'done' | 'timeout' | 'failed' | 'skipped' | 'missed' | 'refused';

export interface ScheduleResult {
  firedAt: string;
  trigger: 'time' | 'manual';
  outcome: ScheduleOutcome;
  reason?: string;
  taskId?: string;
  branch?: string;
  summary?: string;
  endedAt?: string;
}

/** The writable part of a schedule (create and replace). */
export interface ScheduleInput {
  title: string;
  prompt: string;
  repository: string;
  ref?: string;
  model?: string;
  when: ScheduleWhen;
  timeoutMinutes?: number;
  enabled?: boolean;
}

export interface Schedule extends Omit<ScheduleInput, 'timeoutMinutes' | 'enabled'> {
  id: string;
  timeoutMinutes: number;
  enabled: boolean;
  nextRunAt: string | null;
  /** SCHEDULES_TIMEZONE: times are shown in it. */
  zone?: string;
  createdAt: string;
  updatedAt: string;
}

/** One list entry: no results, only the latest. */
export type ScheduleSummary = Schedule & { lastResult?: ScheduleResult };
/** Detail: results newest first. */
export type ScheduleRecord = Schedule & { results: ScheduleResult[] };

export interface SchedulePreview {
  zone: string;
  next: string[];
}

// Architect page (mirrors backend/src/service/architecture/architecture-types.ts).
export type Via = 'call' | 'rest' | 'event' | 'file' | 'other';
export type Severity = 'error' | 'warn' | 'info';
export type FindingStatus = 'open' | 'fixed' | 'accepted';
export type ChangeKind = 'new' | 'changed' | 'removed';
export type PlanSize = 'S' | 'M' | 'L';

export interface ModelLayer { id: string; name: string; mayUse: string[] }
export interface ModelModule { id: string; name: string }
export interface ModelPart { id: string; name: string; layers: ModelLayer[]; modules: ModelModule[] }
export interface ModelComponent {
  id: string; name: string; part: string; layer: string; module: string | null;
  parent: string | null; summary: string; page: string;
}
export interface ModelConnection { from: string; to: string; via: Via }
export interface Model {
  version: 1;
  style: { id: string; name: string };
  parts: ModelPart[];
  components: ModelComponent[];
  connections: ModelConnection[];
}

export interface FullReviewFinding {
  id: string; rule: string; component: string; severity: Severity;
  source: 'depcruise' | 'llm' | 'jscpd' | 'knip'; text: string; status: FindingStatus; since?: string;
}
export interface FullReview {
  version: 1; kind: 'full'; commit: string; reviewedAt: string;
  components: Record<string, { reviewedAt: string }>;
  findings: FullReviewFinding[];
}

export interface PlanProposed {
  name: string; part: string; layer: string; module: string | null; summary: string;
  talks_to: { to: string; via: Via }[];
}
export interface PlanChange { component: string; change: ChangeKind; line: string; proposed?: PlanProposed }
export interface PlanFinding {
  id: string; rule: string; component: string; severity: Severity; text: string;
  alternative?: string; status: FindingStatus;
}
export interface PlanReview {
  version: 1; kind: 'plan'; title: string; plan: string; baseCommit: string; reviewedAt: string;
  size: PlanSize; summary: string; changes: PlanChange[]; findings: PlanFinding[]; passed: string[];
}

// Results of ArchitectureService.
export interface CurrentArchitecture {
  repository: string; branch: string; sha: string; model: Model;
  fullReview: FullReview | null; fullReviewError: string | null; pageBase: string | null;
}
export interface ReviewSummary {
  branch: string; slug: string; sha: string; title: string; plan: string; reviewedAt: string;
  size: PlanSize; summary: string; touched: { component: string; change: ChangeKind }[];
  openFindings: number; findings: number;
}
export interface RefusedReview { branch: string; slug: string | null; file: string; error: string }
export interface ReviewList {
  repository: string; branch: string; sha: string; reviews: ReviewSummary[]; refused: RefusedReview[];
  truncated: boolean;
}
export interface ReviewDetail {
  repository: string; branch: string; sha: string; slug: string; model: Model;
  review: PlanReview; pageBase: string | null;
}

export interface ArchitectureStatus { repositories: string[] }
