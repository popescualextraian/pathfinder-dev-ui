import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { ENGINE_CONFIG, EngineConfig } from '../../commons/engine-config';
import {
  BRIDGE_CLIENT_FACTORY, BridgeClient, BridgeClientFactory, BridgeError, BridgeEvent, BridgeStatus,
  BridgeUnreachableError, waitForStatus,
} from './bridge-client';
import { TASK_LAUNCHER, TaskLauncher } from './task-launcher';
import { TaskRecord, TaskRecordRepository } from '../repository/task-record.repository';
import { repoNameOf } from '../../commons/repo-name';
import { TaskCostService } from './cost/task-cost.service';
import { TaskUpdates } from './task-updates';
import { Live, titleFrom, toView, TaskView, viewsDiffer } from './task-view';


export type { TaskView } from './task-view';

export interface StartTaskInput {
  prompt: string;
  title?: string;
  // A name from the repository list; excludes repoUrl.
  repository?: string;
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
  // Serialises cap check plus launch/start (of new and of woken tasks) so concurrent requests
  // cannot all pass the cap check. Never held while waiting for a bridge.
  private launchQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly records: TaskRecordRepository,
    @Inject(TASK_LAUNCHER) private readonly launcher: TaskLauncher,
    @Inject(BRIDGE_CLIENT_FACTORY) private readonly bridgeFor: BridgeClientFactory,
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
    private readonly updates: TaskUpdates,
    private readonly costs: TaskCostService,
    @Optional() @Inject(TASKS_SERVICE_OPTIONS) options?: TasksServiceOptions,
  ) {
    this.waitTimeoutMs = options?.waitTimeoutMs ?? 60_000;
    this.waitIntervalMs = options?.waitIntervalMs ?? 500;
  }

  async start(input: StartTaskInput): Promise<TaskView> {
    if (input.repoUrl !== undefined && input.repository !== undefined) {
      throw new BadRequestException('Give either repository or repoUrl, not both');
    }
    let repoUrl = input.repoUrl;
    if (input.repository !== undefined) {
      repoUrl = this.config.repositories.find((r) => r.name === input.repository)?.url;
      if (repoUrl === undefined) throw new BadRequestException(`Unknown repository ${input.repository}`);
    } else if (repoUrl !== undefined) {
      this.checkRepoHost(repoUrl);
    }
    const created = await this.exclusive(() => this.launchNew({ ...input, repoUrl }));
    // If the bridge never answers we keep record and container (so the user can stop and remove
    // the task) and report 502; the task then shows up in the list as 'starting'.
    return this.observe(created, await this.waitFor(created, `Task ${created.id} was created but its bridge did not become ready`));
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.launchQueue.then(fn);
    this.launchQueue = run.catch(() => undefined);
    return run;
  }

  // The repository host receives GH_TOKEN (git credential helper), so only known hosts are accepted.
  private checkRepoHost(repoUrl: string): void {
    let host: string | undefined;
    try {
      host = new URL(repoUrl).hostname.toLowerCase();
    } catch {
      host = undefined;
    }
    if (host === undefined || !this.config.allowedRepoHosts.includes(host)) {
      throw new BadRequestException('repoUrl must be on an allowed repository host');
    }
  }

  async list(): Promise<TaskView[]> {
    return (await this.records.list())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map((record) => toView(record));
  }

  async get(id: string): Promise<TaskView> {
    const record = await this.require(id);
    if (record.closed) return toView(record);
    const inspection = await this.launcher.inspect(id);
    if (!inspection.exists) return toView(record, { state: 'stopped', reason: 'container is gone' });
    if (!inspection.running) {
      const state = record.lastState === 'stopped' ? 'stopped' : 'suspended';
      return toView(record, { state, reason: record.lastState === state ? undefined : 'container is not running' });
    }
    try {
      const status = await this.bridgeFor(record).status();
      // A recorded 'stopped' is final: a status read must not bring it back (a stop may be racing).
      return await this.observe(record, status, record.lastState !== 'stopped');
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
    this.updates.markActed(id);
    return this.observe(record, await this.bridgeFor(record).prompt(text));
  }

  async answer(id: string, input: { text: string; question?: string }): Promise<TaskView> {
    const record = await this.wake(id);
    this.updates.markActed(id);
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
    if (record.closed) throw closedConflict(id);
    return this.observe(record, await this.bridgeFor(record).cancel());
  }

  async stop(id: string): Promise<TaskView> {
    const record = await this.require(id);
    if (record.closed) return toView(record);
    try {
      await this.bridgeFor(record).stop();
    } catch {
      // Best effort: whatever the bridge says (starting, unauthorized, unreachable, no URL), the
      // container is stopped below, otherwise the task could never be stopped or removed.
    }
    await this.launcher.stop(id);
    await this.refreshCost(record);
    return this.persist(record, { lastState: 'stopped' });
  }

  // Stops the task if it runs, removes its container and volume and keeps the record as closed
  // (prompt, last response, branch, times). Closing a closed task changes nothing.
  async close(id: string): Promise<TaskView> {
    const record = await this.require(id);
    if (record.closed) return toView(record);
    const inspection = await this.launcher.inspect(id);
    if (inspection.exists && inspection.running) {
      try {
        await this.bridgeFor(record).stop();
      } catch {
        // Best effort, as in stop(): the container goes either way.
      }
      await this.launcher.stop(id);
    }
    await this.refreshCost(record); // the container must still exist; a failed read never blocks the close
    await this.launcher.remove(id);
    this.updates.clearActed(id);
    return this.persist(record, {
      closed: true, closedAt: new Date().toISOString(), lastState: 'stopped',
      lastStatus: { ...(record.lastStatus as object | undefined), state: 'stopped', reason: 'closed', questions: [] },
    });
  }

  // Allowed only for a closed or stopped task: the container is not running and the last known state is
  // 'stopped'. A suspended container is not stopped. A record whose container is gone can go too.
  async remove(id: string): Promise<void> {
    const record = await this.require(id);
    if (record.closed) {
      await this.records.delete(id);
      this.updates.removed(id);
      return;
    }
    const inspection = await this.launcher.inspect(id);
    if (inspection.exists) {
      if (inspection.running || record.lastState !== 'stopped') {
        throw new ConflictException(`Task ${id} is not stopped; stop it before removing it`);
      }
      await this.launcher.remove(id);
    }
    await this.records.delete(id);
    this.updates.removed(id);
  }

  async events(id: string, since: number): Promise<BridgeEvent[]> {
    const record = await this.require(id);
    if (record.closed) throw closedConflict(id);
    const inspection = await this.launcher.inspect(id);
    if (!inspection.exists || !inspection.running) {
      throw new ConflictException(`Task ${id} is not running; its events are not available`);
    }
    return this.bridgeFor(record).events(since);
  }

  // Under the launch lock: cap check, record, container. Does not wait for the bridge.
  private async launchNew(input: StartTaskInput): Promise<TaskRecord> {
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
    const repository = this.config.repositories.find((r) => r.url === repoUrl)?.name ?? repoNameOf(repoUrl);
    const record: TaskRecord = {
      id, title: titleFrom(input.prompt, input.title), prompt: input.prompt, repository, repoUrl, branch, containerName: `agentic-ui-task-${id}`,
      taskToken, agentToken, createdAt: now, updatedAt: now, lastState: 'starting',
    };
    if (input.repoRef !== undefined) record.repoRef = input.repoRef;
    if (input.model !== undefined) record.model = input.model;

    // Record first: a crash between launch and save would orphan a container.
    await this.records.create(record);
    try {
      const { bridgeUrl } = await this.launcher.launch({
        taskId: id, taskToken, agentToken, prompt: input.prompt, repoUrl, repoRef: input.repoRef, model: input.model, branch,
      });
      const launched = await this.records.update(id, { bridgeUrl });
      // The first poll catches up with the events from the beginning, whatever the state is by then.
      this.updates.markActed(id);
      this.updates.changed(toView(launched));
      return launched;
    } catch (error) {
      await this.launcher.remove(id).catch(() => undefined); // a half-made container or volume
      await this.records.delete(id);
      throw error;
    }
  }

  // Makes sure the task can take a prompt: a stopped task is refused at once (409) without
  // starting its container; a container that is not running (suspended, or stopped with
  // `docker stop` while the task was idle or suspended) is started and its bridge awaited.
  // "Stopped" is the recorded last state, or what a reachable bridge says.
  private async wake(id: string): Promise<TaskRecord> {
    const record = await this.require(id);
    if (record.closed) throw closedConflict(id);
    if (record.lastState === 'stopped') throw stoppedConflict(id);
    const inspection = await this.launcher.inspect(id);
    if (!inspection.exists) {
      throw new ConflictException(`Task ${id} has no container any more; it cannot be woken`);
    }
    if (inspection.running) {
      let live: BridgeStatus | undefined;
      try {
        live = await this.bridgeFor(record).status();
      } catch {
        live = undefined; // not answering now: the verb itself reports what goes wrong
      }
      if (live?.state === 'stopped') {
        await this.records.update(id, { lastState: 'stopped', lastStatus: live });
        throw stoppedConflict(id);
      }
      return record;
    }
    await this.exclusive(async () => {
      if ((await this.launcher.countRunning()) >= this.config.maxRunning) {
        throw new ConflictException(`At most ${this.config.maxRunning} tasks can run at once; stop one first`);
      }
      await this.launcher.start(id);
    });
    const woken = await this.waitFor(record, `Task ${id} was started but its bridge did not become ready`);
    if (woken.state === 'stopped') {
      // The bridge had stopped although the record did not know: put the container back down.
      await this.launcher.stop(id).catch(() => undefined);
      await this.records.update(id, { lastState: 'stopped', lastStatus: woken });
      throw stoppedConflict(id);
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

  private async observe(record: TaskRecord, status: BridgeStatus, persist = true): Promise<TaskView> {
    const live: Live = { state: status.state, reason: status.reason, questions: status.questions, summary: status.summary, branch: status.branch ?? undefined };
    if (!persist) return toView(record, live);
    // A task that left starting/running without the poller seeing it still has events to read.
    if (['starting', 'running'].includes(record.lastState ?? 'starting') && !['starting', 'running'].includes(status.state)) {
      this.updates.markActed(record.id);
      return this.persist(record, { lastState: status.state, lastStatus: status, ...this.costs.armRecheck() }, live);
    }
    return this.persist(record, { lastState: status.state, lastStatus: status }, live);
  }

  private async refreshCost(record: TaskRecord): Promise<void> {
    const view = await this.costs.refresh(record);
    if (view) this.updates.changed(view);
  }

  // Writes the patch and announces the task on the status stream when its view changed.
  private async persist(record: TaskRecord, patch: Partial<TaskRecord>, live: Live = {}): Promise<TaskView> {
    const updated = await this.records.update(record.id, patch);
    const view = toView(updated, live);
    if (viewsDiffer(toView(record), view)) this.updates.changed(view);
    return view;
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

function closedConflict(id: string): ConflictException {
  return new ConflictException(`Task ${id} is closed`);
}

function stoppedConflict(id: string): ConflictException {
  return new ConflictException(`Task ${id} takes no prompts or answers: task is stopped`);
}

function token(): string {
  return randomBytes(32).toString('hex');
}
