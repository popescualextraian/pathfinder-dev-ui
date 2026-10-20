import { Subject } from 'rxjs';
import type {
  StoredWorkflow, WorkflowDefinition, WorkflowDefinitionRepository, WorkflowDefinitions, WorkflowSessionSnapshot, WorkflowSessionStart,
  WorkflowTaskSnapshot, WorkflowTaskStart, WorkflowTasks, WorkItem, WorkItems,
} from '../../src/workflow';
import { WorkflowConflictError, WorkflowNotFoundError, WorkflowReadOnlyError } from '../../src/workflow';

// In-memory WorkflowTasks. Sessions change only through the helpers, so tests control every state the runner sees.
export class FakeWorkflowTasks implements WorkflowTasks {
  readonly tasks = new Map<string, WorkflowTaskSnapshot>();
  readonly starts: WorkflowTaskStart[] = [];
  readonly added: Array<{ taskId: string } & WorkflowSessionStart> = [];
  readonly prompts: Array<{ taskId: string; session: string; text: string }> = [];
  readonly files = new Set<string>();
  readonly hasFilesCalls: string[][] = [];
  readonly changes = new Subject<string>();
  private count = 0;
  private clock = 0;

  async start(input: WorkflowTaskStart): Promise<string> {
    this.starts.push(input);
    const id = `T-20261020-${String(++this.count).padStart(4, '0')}`;
    this.tasks.set(id, { id, state: 'starting', branch: `agentic/${id}`, sessions: [{ name: 'main', state: 'starting', openQuestions: 0 }] });
    return id;
  }

  async addSession(taskId: string, session: WorkflowSessionStart): Promise<void> {
    this.added.push({ taskId, ...session });
    this.task(taskId).sessions.push({ name: session.name, state: 'starting', openQuestions: 0 });
  }

  // Like the real engine right after a prompt: the session may still read idle for a moment.
  async prompt(taskId: string, session: string, text: string): Promise<void> {
    this.task(taskId);
    this.prompts.push({ taskId, session, text });
  }

  async get(taskId: string): Promise<WorkflowTaskSnapshot | undefined> {
    const t = this.tasks.get(taskId);
    return t && structuredClone(t);
  }

  async hasFiles(_taskId: string, paths: string[]): Promise<Record<string, boolean>> {
    this.hasFilesCalls.push(paths);
    return Object.fromEntries(paths.map((p) => [p, this.files.has(p)]));
  }

  task(taskId: string): WorkflowTaskSnapshot {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`no task ${taskId}`);
    return t;
  }

  session(taskId: string, name: string): WorkflowSessionSnapshot {
    const s = this.task(taskId).sessions.find((x) => x.name === name);
    if (!s) throw new Error(`no session ${name}`);
    return s;
  }

  setSession(taskId: string, name: string, patch: Partial<WorkflowSessionSnapshot>): void {
    Object.assign(this.session(taskId, name), patch);
  }

  /** The session's turn ended: idle with a new final message. */
  finishTurn(taskId: string, name: string): void {
    this.setSession(taskId, name, { state: 'idle', openQuestions: 0, lastMessageAt: new Date(Date.UTC(2026, 9, 20, 12, 0, ++this.clock)).toISOString() });
  }

  emit(taskId: string): void {
    this.changes.next(taskId);
  }
}

export class FakeWorkItems implements WorkItems {
  readonly items = new Map<string, WorkItem>();
  readonly moves: Array<{ itemId: string; stage: string }> = [];
  moveFailure?: Error;

  constructor(items: WorkItem[] = []) {
    for (const i of items) this.items.set(i.id, i);
  }

  async get(itemId: string): Promise<WorkItem | undefined> {
    return this.items.get(itemId);
  }

  async moveTo(itemId: string, stage: string): Promise<void> {
    if (this.moveFailure) throw this.moveFailure;
    this.moves.push({ itemId, stage });
    const item = this.items.get(itemId);
    if (item) item.stage = stage;
  }
}

export class FakeDefinitions implements WorkflowDefinitionRepository {
  private versions = new Map<string, number>();
  isWritable = true;

  constructor(private readonly defs: WorkflowDefinition[]) {}

  async list(): Promise<WorkflowDefinitions> {
    return { definitions: this.defs, refused: [] };
  }

  async get(id: string): Promise<WorkflowDefinition | undefined> {
    return this.defs.find((d) => d.id === id);
  }

  async read(id: string): Promise<StoredWorkflow> {
    const definition = this.defs.find((d) => d.id === id);
    if (!definition) throw new WorkflowNotFoundError('Workflow not found');
    return { definition, version: String(this.versions.get(id) ?? 0) };
  }

  async save(id: string, definition: WorkflowDefinition, expectedVersion?: string): Promise<StoredWorkflow> {
    if (!this.isWritable) throw new WorkflowReadOnlyError();
    const at = this.defs.findIndex((d) => d.id === id);
    if (expectedVersion === undefined && at >= 0) throw new WorkflowConflictError('exists');
    if (expectedVersion !== undefined && at < 0) throw new WorkflowNotFoundError('Workflow not found');
    if (expectedVersion !== undefined && expectedVersion !== String(this.versions.get(id) ?? 0)) throw new WorkflowConflictError('changed');
    const next = { ...definition, id };
    if (at >= 0) this.defs[at] = next; else this.defs.push(next);
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    return { definition: next, version: String(this.versions.get(id)) };
  }

  async delete(id: string, expectedVersion: string): Promise<void> {
    if (!this.isWritable) throw new WorkflowReadOnlyError();
    const at = this.defs.findIndex((d) => d.id === id);
    if (at < 0) throw new WorkflowNotFoundError('Workflow not found');
    if (expectedVersion !== String(this.versions.get(id) ?? 0)) throw new WorkflowConflictError('changed');
    this.defs.splice(at, 1);
  }

  async deleteRefused(): Promise<void> {
    throw new WorkflowNotFoundError('Workflow file not found');
  }

  async writable(): Promise<boolean> {
    return this.isWritable;
  }
}
