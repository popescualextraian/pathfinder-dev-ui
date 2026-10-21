import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { assertWorktreePaths } from './worktree-paths';
import { randomBytes, randomInt } from 'node:crypto';
import { ENGINE_CONFIG, EngineConfig } from '../../commons/engine-config';
import {
  AppAction, BRIDGE_CLIENT_FACTORY, BridgeApp, BridgeClient, AddSessionInput as BridgeAddSessionInput, AnswerInput, BridgeClientFactory,
  BridgeError, BridgeEvent, BridgeStatus, BridgeUnreachableError, waitForStatus,
} from './bridge-client';
import { AppPorts, TASK_LAUNCHER, TaskFileName, TaskInspection, TaskLauncher, WORKTREE_FILE_MAX_BYTES } from './task-launcher';
import { assertTaskFileName } from './worktree-paths';
import { needsSummaryLine, readSummaryLine, recordedLive, recordGoneEnd, scheduledRunEnded } from './task-end';
import { RecordPatch, TaskKind, TaskRecord, TaskRecordRepository } from '../repository/task-record.repository';
import { repoNameOf } from '../../commons/repo-name';
import { TaskCostService } from './cost/task-cost.service';
import { TaskUpdates } from './task-updates';
import { hasSession, Live, MAIN_SESSION, mergeSessions, titleFrom, toView, TaskView, viewsDiffer } from './task-view';


export type { TaskView } from './task-view';
export type { TaskKind } from '../repository/task-record.repository';

// An app of a task as the API shows it; `link` is the host URL of the first port, null without a host port.
export interface AppView extends BridgeApp {
  link: string | null;
}

export interface StartTaskInput {
  prompt: string;
  title?: string;
  // A name from the repository list; excludes repoUrl.
  repository?: string;
  repoUrl?: string;
  repoRef?: string;
  model?: string;
  // Set by code that starts tasks for a purpose; the public API does not accept it.
  kind?: TaskKind;
  // A scheduled run (set by the schedules, not the public API): the bridge works unattended, asks for a
  // summary (result.md) when the agent ends its turn or at the timeout, stops the task and exits.
  // runTimeoutSeconds: whole seconds, 60..86400 (what the bridge accepts).
  scheduled?: { runTimeoutSeconds: number };
  // The schedule that started the task, kept on the record and shown in the view.
  scheduleId?: string;
  scheduleTitle?: string;
}

export const MIN_RUN_TIMEOUT_SECONDS = 60;
export const MAX_RUN_TIMEOUT_SECONDS = 86_400;

export interface AddSessionInput {
  name: string;
  model?: string;
  // Name of the session to copy the conversation from.
  forkFrom?: string;
  // First prompt of the new session.
  prompt?: string;
}

export interface TasksServiceOptions {
  // How long to wait for a bridge to answer after launch or wake-up, and how often to poll.
  waitTimeoutMs?: number;
  waitIntervalMs?: number;
}
export const TASKS_SERVICE_OPTIONS = Symbol('TASKS_SERVICE_OPTIONS');

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

const EVENTS_PAGE = 1000;

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
    if (input.scheduled !== undefined) {
      const seconds = input.scheduled.runTimeoutSeconds;
      if (!Number.isInteger(seconds) || seconds < MIN_RUN_TIMEOUT_SECONDS || seconds > MAX_RUN_TIMEOUT_SECONDS) {
        throw new BadRequestException(`The run timeout of a scheduled task must be whole seconds from ${MIN_RUN_TIMEOUT_SECONDS} to ${MAX_RUN_TIMEOUT_SECONDS}`);
      }
    }
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
    let status: BridgeStatus;
    try {
      status = await this.waitFor(created, `Task ${created.id} was created but its bridge did not become ready`);
    } catch (error) {
      // A scheduled run that was over before we saw its bridge: the poller (marked by launchNew) records its end.
      if (error instanceof RunAlreadyEndedError) return toView(created);
      throw error;
    }
    return this.observe(created, status);
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

  // A scheduled run recorded as live whose container (or bridge process) no longer runs has ended: its end is
  // recorded from state.json (as the poller does), so a read never shows such a run as suspended.
  async get(id: string): Promise<TaskView> {
    const record = await this.require(id);
    if (record.closed) return toView(record);
    const inspection = await this.launcher.inspect(id);
    if (record.scheduled !== undefined && recordedLive(record) && !(inspection.exists && inspection.running)) {
      return toView(await this.recordEnd(record, inspection));
    }
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

  async prompt(id: string, text: string, session?: string): Promise<TaskView> {
    const record = await this.wake(id);
    this.updates.markActed(id);
    const client = this.bridgeFor(record);
    return this.observe(record, await (session === undefined ? client.prompt(text) : client.prompt(text, session)));
  }

  // A new session in the task; wakes the task like prompt does.
  async addSession(id: string, input: AddSessionInput): Promise<TaskView> {
    const record = await this.wake(id);
    this.updates.markActed(id);
    const client = this.bridgeFor(record);
    const bridgeInput: BridgeAddSessionInput = { name: input.name };
    if (input.model !== undefined) bridgeInput.model = input.model;
    if (input.forkFrom !== undefined) bridgeInput.fork = input.forkFrom;
    if (input.prompt !== undefined) bridgeInput.text = input.prompt;
    await client.addSession(bridgeInput);
    return this.observe(record, await client.status());
  }

  // Without a question id the oldest open question answers (of the given session, if any), and the
  // answer goes to the session that asked.
  async answer(id: string, input: { text: string; question?: string; session?: string }): Promise<TaskView> {
    const record = await this.wake(id);
    this.updates.markActed(id);
    const client = this.bridgeFor(record);
    let question = input.question;
    let session = input.session;
    if (question === undefined) {
      const open = (await client.status()).questions
        .filter((q) => input.session === undefined || (q.session ?? MAIN_SESSION) === input.session)
        .sort((a, b) => a.asked.localeCompare(b.asked));
      question = open[0]?.id; // none: the bridge answers 409 itself
      if (open[0]?.session !== undefined) session = open[0].session;
    }
    const body: AnswerInput = { text: input.text, question };
    if (session !== undefined) body.session = session;
    return this.observe(record, await client.answer(body));
  }

  async cancel(id: string, session?: string): Promise<TaskView> {
    const record = await this.require(id);
    if (record.closed) throw closedConflict(id);
    const client = this.bridgeFor(record);
    return this.observe(record, await (session === undefined ? client.cancel() : client.cancel(session)));
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
    // A scheduled run's summary line, read while the container still exists.
    const summary = needsSummaryLine({ ...record, closed: true }) ? { summaryLine: await readSummaryLine(this.launcher, id) } : {};
    await this.launcher.remove(id);
    this.updates.clearActed(id);
    return this.persist(record, {
      ...summary,
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

  // `session`: only that session's events and the task-level ones without a session name.
  // NotFoundException for a session the task does not have.
  async events(id: string, since: number, session?: string): Promise<BridgeEvent[]> {
    const record = await this.require(id);
    if (record.closed) throw closedConflict(id);
    if (session !== undefined && !hasSession(record, session)) throw new NotFoundException(`Task ${id} has no session ${session}`);
    const inspection = await this.launcher.inspect(id);
    if (!inspection.exists || !inspection.running) {
      throw new ConflictException(`Task ${id} is not running; its events are not available`);
    }
    const client = this.bridgeFor(record);
    if (session === undefined) return client.events(since);
    // The bridge's session filter drops unnamed task-level events, so filter here like the SSE stream does
    // (the session's own and the unnamed ones), reading the bridge's pages (1000 events) until the last one.
    const out: BridgeEvent[] = [];
    for (let from = since; ;) {
      const page = await client.events(from, EVENTS_PAGE);
      out.push(...page.filter((e) => e.name == null || e.name === session));
      if (page.length < EVENTS_PAGE) return out;
      from = page[page.length - 1].seq;
    }
  }

  async apps(id: string): Promise<AppView[]> {
    const { client, record } = await this.appsOf(id);
    return (await client.apps()).map((app) => toAppView(record, app));
  }

  async appAction(id: string, name: string, action: AppAction): Promise<AppView> {
    const { client, record } = await this.appsOf(id);
    return toAppView(record, await client.appAction(name, action));
  }

  async appLogs(id: string, name: string, lines: number): Promise<{ lines: string[] }> {
    const { client } = await this.appsOf(id);
    return { lines: await client.appLogs(name, lines) };
  }

  // Apps need the Docker launcher's published ports and a running container that was not stopped for good.
  private async appsOf(id: string): Promise<{ client: BridgeClient; record: TaskRecord }> {
    const record = await this.require(id);
    if (this.config.launcher === 'local') throw new ConflictException('Apps need the Docker launcher');
    if (record.closed) throw closedConflict(id);
    if (record.lastState === 'stopped') throw new ConflictException(`Task ${id} is stopped; its apps are not available`);
    const inspection = await this.launcher.inspect(id);
    if (!inspection.exists || !inspection.running) {
      throw new ConflictException(`Task ${id} is not running; its apps are not available`);
    }
    return { client: this.bridgeFor(record), record };
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
    if (input.kind !== undefined) record.kind = input.kind;
    if (input.scheduled !== undefined) record.scheduled = { runTimeoutSeconds: input.scheduled.runTimeoutSeconds };
    if (input.scheduleId !== undefined) record.scheduleId = input.scheduleId;
    if (input.scheduleTitle !== undefined) record.scheduleTitle = input.scheduleTitle;

    // Record first: a crash between launch and save would orphan a container.
    await this.records.create(record);
    try {
      const { bridgeUrl, appPorts } = await this.launcher.launch({
        taskId: id, taskToken, agentToken, prompt: input.prompt, repoUrl, repoRef: input.repoRef, model: input.model, branch,
        ...(record.scheduled ? { scheduled: record.scheduled } : {}),
      });
      const launched = await this.records.update(id, appPorts ? { bridgeUrl, appPorts } : { bridgeUrl });
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
    let record = await this.require(id);
    if (record.closed) throw closedConflict(id);
    if (scheduledRunEnded(record)) throw scheduledConflict(id);
    if (record.lastState === 'stopped') throw stoppedConflict(id);
    const inspection = await this.launcher.inspect(id);
    // A scheduled run has no idle suspension: a container that is not running (or gone) is a run that is over;
    // its end is recorded from state.json before the refusal, so the record does not stay live.
    if (record.scheduled !== undefined && !(inspection.exists && inspection.running)) {
      await this.recordEnd(record, inspection);
      throw scheduledConflict(id);
    }
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
        await this.persist(record, { lastState: 'stopped', lastStatus: live });
        throw record.scheduled !== undefined ? scheduledConflict(id) : stoppedConflict(id);
      }
      return record;
    }
    let appPorts: AppPorts | undefined;
    await this.exclusive(async () => {
      if ((await this.launcher.countRunning()) >= this.config.maxRunning) {
        throw new ConflictException(`At most ${this.config.maxRunning} tasks can run at once; stop one first`);
      }
      appPorts = await this.launcher.start(id);
    });
    // The links must point at the current host ports.
    if (appPorts) record = await this.records.update(id, { appPorts });
    const woken = await this.waitFor(record, `Task ${id} was started but its bridge did not become ready`);
    if (woken.state === 'stopped') {
      // The bridge had stopped although the record did not know: put the container back down.
      await this.launcher.stop(id).catch(() => undefined);
      await this.records.update(id, { lastState: 'stopped', lastStatus: woken });
      throw stoppedConflict(id);
    }
    return record;
  }

  // The end of a task whose container is not running, from its state.json (a stop or close meanwhile wins), announced.
  private async recordEnd(record: TaskRecord, inspection: TaskInspection): Promise<TaskRecord> {
    const gone = await recordGoneEnd(this.records, this.launcher, () => this.costs.armRecheck(), record.id, inspection);
    if (gone === undefined) return record;
    if (viewsDiffer(toView(gone.before), toView(gone.updated))) this.updates.changed(toView(gone.updated));
    return gone.updated;
  }

  private async waitFor(record: TaskRecord, message: string): Promise<BridgeStatus> {
    const client = this.bridgeFor(record) as BridgeClient;
    // The bridge of a scheduled run exits by itself when the run is over: once its container stops, waiting is pointless.
    const status = record.scheduled === undefined ? () => client.status() : async (): Promise<BridgeStatus> => {
      try {
        return await client.status();
      } catch (error) {
        if (error instanceof BridgeUnreachableError && !(await this.launcher.inspect(record.id)).running) throw new RunAlreadyEndedError();
        throw error;
      }
    };
    try {
      return await waitForStatus({ status }, { timeoutMs: this.waitTimeoutMs, intervalMs: this.waitIntervalMs });
    } catch (error) {
      if (error instanceof BridgeError || error instanceof RunAlreadyEndedError) throw error;
      throw new BadGatewayException(`${message}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private async observe(record: TaskRecord, status: BridgeStatus, persist = true): Promise<TaskView> {
    const live: Live = {
      state: status.state, reason: status.reason, questions: status.questions, summary: status.summary,
      sessions: status.sessions, branch: status.branch ?? undefined,
    };
    if (!persist) return toView(record, live);
    // The sessions are merged into the record as it is at write time: the poller keeps their last messages.
    const sessions = (current: TaskRecord): Partial<TaskRecord> =>
      status.sessions ? { sessions: mergeSessions(current.sessions, status.sessions) } : {};
    // A task that left starting/running without the poller seeing it still has events to read.
    if (['starting', 'running'].includes(record.lastState ?? 'starting') && !['starting', 'running'].includes(status.state)) {
      this.updates.markActed(record.id);
      return this.persist(record, (current) => ({ lastState: status.state, lastStatus: status, ...sessions(current), ...this.costs.armRecheck() }), live);
    }
    return this.persist(record, (current) => ({ lastState: status.state, lastStatus: status, ...sessions(current) }), live);
  }

  private async refreshCost(record: TaskRecord): Promise<void> {
    const view = await this.costs.refresh(record);
    if (view) this.updates.changed(view);
  }

  // Writes the patch and announces the task on the status stream when its view changed. A scheduled run
  // that has just ended gets its summary line (result.md) in the same go.
  private async persist(record: TaskRecord, patch: RecordPatch, live: Live = {}): Promise<TaskView> {
    let updated = await this.records.update(record.id, patch);
    if (needsSummaryLine(updated)) {
      const summaryLine = await readSummaryLine(this.launcher, record.id);
      updated = await this.records.update(record.id, (current) => (current.summaryLine === undefined ? { summaryLine } : undefined));
    }
    const view = toView(updated, live);
    if (viewsDiffer(toView(record), view)) this.updates.changed(view);
    return view;
  }

  // Whether each path exists in the task's worktree (as the agent sees it); works on a stopped task.
  async hasFiles(id: string, paths: string[]): Promise<Record<string, boolean>> {
    assertWorktreePaths(paths);
    const record = await this.require(id);
    return this.launcher.hasFiles(record.id, paths);
  }

  // Text of one worktree file or null when missing; larger than maxBytes (default 64 KB) is an error. Works on a stopped task.
  async readFile(id: string, path: string, maxBytes: number = WORKTREE_FILE_MAX_BYTES): Promise<string | null> {
    assertWorktreePaths([path]);
    const record = await this.require(id);
    return this.launcher.readFile(record.id, path, maxBytes);
  }

  // Text of result.md or state.json in the task's /task folder, or null when missing; works on a stopped task
  // (Docker: also on an exited container). 400 for another name; WorktreeFileTooLargeError over 64 KB.
  async readTaskFile(id: string, name: TaskFileName): Promise<string | null> {
    assertTaskFileName(name);
    const record = await this.require(id);
    return this.launcher.readTaskFile(record.id, name);
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

function toAppView(record: TaskRecord, app: BridgeApp): AppView {
  const hostPort = app.ports.length ? record.appPorts?.[app.name]?.[String(app.ports[0])] : undefined;
  return { ...app, link: hostPort === undefined ? null : `http://localhost:${hostPort}${app.url}` };
}

function closedConflict(id: string): ConflictException {
  return new ConflictException(`Task ${id} is closed`);
}

function stoppedConflict(id: string): ConflictException {
  return new ConflictException(`Task ${id} takes no prompts or answers: task is stopped`);
}

// waitFor of a scheduled run whose bridge is already gone (the run ended before it was seen).
class RunAlreadyEndedError extends Error {}

function scheduledConflict(id: string): ConflictException {
  return new ConflictException(`Task ${id} takes no prompts, answers or sessions: its scheduled run has ended`);
}

function token(): string {
  return randomBytes(32).toString('hex');
}
