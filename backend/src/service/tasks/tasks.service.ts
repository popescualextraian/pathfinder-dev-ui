import { BadGatewayException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { ENGINE_CONFIG, EngineConfig } from '../../commons/engine-config';
import {
  BridgeClient, BridgeError, BridgeEvent, BridgeQuestion, BridgeStatus, BridgeUnreachableError, waitForStatus,
} from '../../repository/tasks/bridge/bridge-client';
import { BRIDGE_CLIENT_FACTORY, BridgeClientFactory } from '../../repository/tasks/bridge/bridge-client.factory';
import { TASK_LAUNCHER, TaskLauncher } from '../../repository/tasks/launcher/task-launcher';
import { TaskRecord, TaskRecordRepository } from '../../repository/tasks/task-record.repository';

// What clients see of a task: the record without the tokens, plus state from the bridge.
export interface TaskView {
  id: string;
  prompt: string;
  repoUrl: string;
  repoRef?: string;
  model?: string;
  branch: string;
  containerName: string;
  bridgeUrl?: string;
  createdAt: string;
  updatedAt: string;
  state: string;
  reason?: string;
  questions: BridgeQuestion[];
  summary?: string;
}

export interface StartTaskInput {
  prompt: string;
  repoUrl?: string;
  repoRef?: string;
  model?: string;
}

export interface TasksServiceOptions {
  // How long to wait for a bridge to answer after launch or wake-up, and how often to poll.
  waitTimeoutMs?: number;
  waitIntervalMs?: number;
}
export const TASKS_SERVICE_OPTIONS = Symbol('TASKS_SERVICE_OPTIONS');

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

@Injectable()
export class TasksService {
  private readonly waitTimeoutMs: number;
  private readonly waitIntervalMs: number;
  // Serialises start() so two concurrent starts cannot both pass the cap check.
  private startQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly records: TaskRecordRepository,
    @Inject(TASK_LAUNCHER) private readonly launcher: TaskLauncher,
    @Inject(BRIDGE_CLIENT_FACTORY) private readonly bridgeFor: BridgeClientFactory,
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
    @Optional() @Inject(TASKS_SERVICE_OPTIONS) options?: TasksServiceOptions,
  ) {
    this.waitTimeoutMs = options?.waitTimeoutMs ?? 60_000;
    this.waitIntervalMs = options?.waitIntervalMs ?? 500;
  }

  start(input: StartTaskInput): Promise<TaskView> {
    const run = this.startQueue.then(() => this.doStart(input));
    this.startQueue = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<TaskView[]> {
    return (await this.records.list()).map((record) => toView(record));
  }

  async get(id: string): Promise<TaskView> {
    const record = await this.require(id);
    const inspection = await this.launcher.inspect(id);
    if (!inspection.exists) return toView(record, { state: 'stopped', reason: 'container is gone' });
    if (!inspection.running) {
      const state = record.lastState === 'stopped' ? 'stopped' : 'suspended';
      return toView(record, { state, reason: record.lastState === state ? undefined : 'container is not running' });
    }
    try {
      return await this.observe(record, await this.bridgeFor(record).status());
    } catch (error) {
      // Bridge not (yet) reachable: show what was last known.
      if (error instanceof BridgeUnreachableError || (error instanceof BridgeError && error.status === 503)) {
        return toView(record);
      }
      throw error;
    }
  }

  async prompt(id: string, text: string): Promise<TaskView> {
    const record = await this.wake(id);
    return this.observe(record, await this.bridgeFor(record).prompt(text));
  }

  async answer(id: string, input: { text: string; question?: string }): Promise<TaskView> {
    const record = await this.wake(id);
    const client = this.bridgeFor(record);
    let question = input.question;
    if (question === undefined) {
      const open = [...(await client.status()).questions].sort((a, b) => a.asked.localeCompare(b.asked));
      question = open[0]?.id; // none: the bridge answers 409 itself
    }
    return this.observe(record, await client.answer({ text: input.text, question }));
  }

  async cancel(id: string): Promise<TaskView> {
    const record = await this.require(id);
    return this.observe(record, await this.bridgeFor(record).cancel());
  }

  async stop(id: string): Promise<TaskView> {
    const record = await this.require(id);
    try {
      await this.bridgeFor(record).stop();
    } catch (error) {
      if (!(error instanceof BridgeUnreachableError)) throw error;
    }
    await this.launcher.stop(id);
    const updated = await this.records.update(id, { lastState: 'stopped' });
    return toView(updated);
  }

  // Allowed only for a stopped task: the container is not running and the last known state is
  // 'stopped'. A suspended container is not stopped. A record whose container is gone can go too.
  async remove(id: string): Promise<void> {
    const record = await this.require(id);
    const inspection = await this.launcher.inspect(id);
    if (inspection.exists) {
      if (inspection.running || record.lastState !== 'stopped') {
        throw new ConflictException(`Task ${id} is not stopped; stop it before removing it`);
      }
      await this.launcher.remove(id);
    }
    await this.records.delete(id);
  }

  async events(id: string, since: number): Promise<BridgeEvent[]> {
    const record = await this.require(id);
    return this.bridgeFor(record).events(since);
  }

  private async doStart(input: StartTaskInput): Promise<TaskView> {
    if ((await this.launcher.countRunning()) >= this.config.maxRunning) {
      throw new ConflictException(`At most ${this.config.maxRunning} tasks can run at once`);
    }
    const id = await this.newId();
    const taskToken = token();
    let agentToken = token();
    while (agentToken === taskToken) agentToken = token();
    const now = new Date().toISOString();
    const branch = `agentic/${id}`;
    const repoUrl = input.repoUrl ?? this.config.repoUrl;
    const record: TaskRecord = {
      id, prompt: input.prompt, repoUrl, branch, containerName: `agentic-ui-task-${id}`,
      taskToken, agentToken, createdAt: now, updatedAt: now, lastState: 'starting',
    };
    if (input.repoRef !== undefined) record.repoRef = input.repoRef;
    if (input.model !== undefined) record.model = input.model;

    // Record first: a crash between launch and save would orphan a container.
    await this.records.create(record);
    let created: TaskRecord;
    try {
      const { bridgeUrl } = await this.launcher.launch({
        taskId: id, taskToken, agentToken, prompt: input.prompt, repoUrl, repoRef: input.repoRef, model: input.model, branch,
      });
      created = await this.records.update(id, { bridgeUrl });
    } catch (error) {
      await this.launcher.remove(id).catch(() => undefined); // a half-made container or volume
      await this.records.delete(id);
      throw error;
    }

    // If the bridge never answers we keep record and container (so the user can stop and remove
    // the task) and report 502; the task then shows up in the list as 'starting'.
    return this.observe(created, await this.waitFor(created, `Task ${id} was created but its bridge did not become ready`));
  }

  // Starts a container that is not running and waits for its bridge, so a prompt can be sent.
  private async wake(id: string): Promise<TaskRecord> {
    const record = await this.require(id);
    const inspection = await this.launcher.inspect(id);
    if (!inspection.exists) {
      throw new ConflictException(`Task ${id} has no container any more; it cannot be woken`);
    }
    if (!inspection.running) {
      if ((await this.launcher.countRunning()) >= this.config.maxRunning) {
        throw new ConflictException(`At most ${this.config.maxRunning} tasks can run at once; stop one first`);
      }
      await this.launcher.start(id);
      await this.waitFor(record, `Task ${id} was started but its bridge did not become ready`);
    }
    return record;
  }

  private async waitFor(record: TaskRecord, message: string): Promise<BridgeStatus> {
    try {
      return await waitForStatus(this.bridgeFor(record) as BridgeClient, {
        timeoutMs: this.waitTimeoutMs, intervalMs: this.waitIntervalMs,
      });
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      throw new BadGatewayException(`${message}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private async observe(record: TaskRecord, status: BridgeStatus): Promise<TaskView> {
    const updated = await this.records.update(record.id, { lastState: status.state, lastStatus: status });
    return toView(updated, { state: status.state, reason: status.reason, questions: status.questions, summary: status.summary, branch: status.branch ?? undefined });
  }

  private async require(id: string): Promise<TaskRecord> {
    let record: TaskRecord | undefined;
    try {
      record = await this.records.get(id);
    } catch {
      record = undefined; // malformed id
    }
    if (!record) throw new NotFoundException(`Task ${id} not found`);
    return record;
  }

  private async newId(): Promise<string> {
    const d = new Date();
    const date = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    for (;;) {
      let suffix = '';
      for (let i = 0; i < 4; i++) suffix += ID_CHARS[randomInt(ID_CHARS.length)];
      const id = `T-${date}-${suffix}`;
      if (!(await this.records.get(id))) return id;
    }
  }
}

function token(): string {
  return randomBytes(32).toString('hex');
}

interface Live {
  state?: string;
  reason?: string;
  questions?: BridgeQuestion[];
  summary?: string;
  branch?: string;
}

// Built field by field so a token can never slip into a view.
function toView(record: TaskRecord, live: Live = {}): TaskView {
  const last = (record.lastStatus ?? {}) as Partial<BridgeStatus>;
  const view: TaskView = {
    id: record.id,
    prompt: record.prompt,
    repoUrl: record.repoUrl,
    branch: live.branch ?? record.branch,
    containerName: record.containerName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    state: live.state ?? record.lastState ?? 'starting',
    questions: live.questions ?? last.questions ?? [],
  };
  if (record.repoRef !== undefined) view.repoRef = record.repoRef;
  if (record.model !== undefined) view.model = record.model;
  if (record.bridgeUrl !== undefined) view.bridgeUrl = record.bridgeUrl;
  const reason = live.reason ?? last.reason;
  if (reason !== undefined) view.reason = reason;
  const summary = live.summary ?? last.summary;
  if (summary !== undefined) view.summary = summary;
  return view;
}
