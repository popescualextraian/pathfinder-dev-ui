import { ConflictException, Logger } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { EngineConfig } from '../../../commons/engine-config';
import { LEDGER_MAX_BYTES, TASK_FILE_MAX_BYTES, LaunchResult, LaunchSpec, TASK_GRANTS, TaskInspection, TaskLauncher, WorktreeFileTooLargeError } from '../../service/task-launcher';
import { TaskFileName, assertTaskFileName, assertWorktreePaths } from '../../service/worktree-paths';
import { gitCredentialEnv } from './git-credential-env';

type LauncherConfig = Pick<
  EngineConfig,
  'dataDir' | 'project' | 'localAgent' | 'claudeCodeOauthToken' | 'ghToken' | 'gitName' | 'gitEmail'
>;

const FAKE_AGENT_RELATIVE = join('tools', 'fake-agent', 'fake-agent.mjs');
const KILL_TIMEOUT_MS = 5000;
const CLONE_TIMEOUT_MS = 120_000;
const LOG_LIMIT = 64 * 1024;
const DEFAULT_AGENTIC_DIR = '/opt/agentic';
const START_TIMEOUT_MS = 120_000;
const START_POLL_MS = 100;
const FAILURE_LINES = 10;

// The fake agent lives in tools/ at the repository root, next to backend/src and dist/backend:
// walk up from this file until it is found (works from src and from dist).
export function findFakeAgent(from: string = __dirname): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const candidate = join(dir, FAKE_AGENT_RELATIVE);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error(`The fake agent ${FAKE_AGENT_RELATIVE} was not found above ${from}`);
  }
}

export interface BridgeEnvInput {
  config: LauncherConfig;
  spec: LaunchSpec;
  taskDir: string;
  workDir: string;
  port: number;
  path: string | undefined;
  fakeAgent: string;
}

// The bridge's environment, built explicitly (nothing is inherited). Fake agent: no secret at all
// (the task and agent tokens are the bridge's own, not credentials of anything else). Claude:
// the OAuth token, and for a URL repository the push token with the git credential helper
// settings and the commit identity, as in a Docker task.
export function bridgeEnv({ config, spec, taskDir, workDir, port, path, fakeAgent }: BridgeEnvInput): Record<string, string> {
  const env: Record<string, string> = {
    ...(path ? { PATH: path } : {}),
    HOME: taskDir,
    AGENTIC_TASK_TOKEN: spec.taskToken,
    AGENTIC_AGENT_TOKEN: spec.agentToken,
    AGENTIC_TASK_ID: spec.taskId,
    AGENTIC_PROJECT: config.project,
    AGENTIC_TASK_DIR: join(taskDir, 'task'),
    AGENTIC_COST_LEDGER_DIR: join(taskDir, 'task'),
    AGENTIC_PROMPT: spec.prompt,
    AGENTIC_WORKTREE: '1',
    AGENTIC_BRANCH: spec.branch,
    AGENTIC_WORK: workDir,
    AGENTIC_STATE: join(taskDir, 'state'),
    AGENTIC_EVENTS_DIR: join(taskDir, 'no-events'),
    AGENTIC_BRIDGE_PORT: String(port),
    AGENTIC_ALLOWED_ACTIONS: TASK_GRANTS,
    // On whatever the entrypoint's default is: a local task never runs unguarded.
    AGENTIC_GATE: '1',
  };
  if (spec.scheduled) Object.assign(env, { AGENTIC_SCHEDULED: '1', AGENTIC_RUN_TIMEOUT: String(spec.scheduled.runTimeoutSeconds) });
  if (spec.model) env.AGENTIC_MODEL = spec.model;
  if (config.localAgent === 'fake') {
    env.AGENTIC_ACP_CMD = JSON.stringify(['node', fakeAgent]);
    env.FAKE_AGENT_STATE = join(taskDir, 'agent-state');
    return env;
  }
  env.CLAUDE_CODE_OAUTH_TOKEN = config.claudeCodeOauthToken;
  if (config.ghToken) env.GH_TOKEN = config.ghToken;
  if (config.gitName) Object.assign(env, { GIT_AUTHOR_NAME: config.gitName, GIT_COMMITTER_NAME: config.gitName });
  if (config.gitEmail) Object.assign(env, { GIT_AUTHOR_EMAIL: config.gitEmail, GIT_COMMITTER_EMAIL: config.gitEmail });
  return { ...env, ...gitCredentialEnv(spec.repoUrl) };
}

// The environment of the clone the launcher itself runs: never prompts; with a push token the
// credential helper references GH_TOKEN (the token is in no URL, argument or file).
// Overridable commands and timeouts (tests inject stubs).
export interface LocalLauncherOptions {
  cloneTimeoutMs?: number;
  gitCommand?: string;
  bridgeCommand?: string;
  // The image's folder with entrypoint.sh and start.d (default: AGENTIC_DIR or /opt/agentic).
  agenticDir?: string;
  // How long a launch waits for the start steps to finish and the bridge to listen.
  startTimeoutMs?: number;
}

export function cloneEnv(config: Pick<LauncherConfig, 'ghToken'>, spec: Pick<LaunchSpec, 'repoUrl'>, taskDir: string, path: string | undefined): Record<string, string> {
  const credentials = config.ghToken ? gitCredentialEnv(spec.repoUrl) : {};
  return {
    ...(path ? { PATH: path } : {}),
    HOME: taskDir,
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
    // Only for a URL repository: a local path has nothing to authenticate against.
    ...(Object.keys(credentials).length > 0 ? { GH_TOKEN: config.ghToken, ...credentials } : {}),
  };
}

interface LocalTask {
  port: number;
  dir: string;
  env: Record<string, string>;
  child?: ChildProcess;
  log: string;
  // While the folder is cloned and the bridge not yet spawned.
  launching: boolean;
  cancelled: boolean;
  cloneChild?: ChildProcess;
  launchDone: Promise<void>;
  stopping: boolean;
  // Settles when the bridge process and its output streams are closed.
  closed?: Promise<void>;
  // While a launch or respawn waits for the bridge: an early exit is reported by that wait.
  awaitingUp?: boolean;
  // A scheduled run (AGENTIC_SCHEDULED): its bridge exits by itself when the run is over.
  scheduled: boolean;
}

// The bridge's own final states in state.json: a scheduled run that reached one is over.
const FINAL_STATES = new Set(['stopped', 'failed']);

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolvePort(port));
    });
  });
}

// Signals the child's whole process group (children are spawned detached, so the group is theirs).
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, signal);
  } catch {
    // The group is already gone.
  }
}

// Development only: a task is an `agentic-bridge` child process in this container (started through
// the image's entrypoint, so it gets the start steps and the gate of a Docker task), in its own
// folder under <dataDir>/local-tasks, on its own port that the launcher reaches on the loopback
// address (the bridge itself listens on all interfaces; its tokens protect it). No isolation
// between tasks. Tasks do not survive an app restart.
export class LocalTaskLauncher implements TaskLauncher {
  private readonly tasks = new Map<string, LocalTask>();
  private readonly logger = new Logger('LocalTaskLauncher');
  private readonly cloneTimeoutMs: number;
  private readonly gitCommand: string;
  private readonly bridgeCommand: string;
  private readonly agenticDir: string;
  private readonly startTimeoutMs: number;

  constructor(private readonly config: LauncherConfig, options: LocalLauncherOptions = {}) {
    this.cloneTimeoutMs = options.cloneTimeoutMs ?? CLONE_TIMEOUT_MS;
    this.gitCommand = options.gitCommand ?? 'git';
    this.bridgeCommand = options.bridgeCommand ?? 'agentic-bridge';
    this.agenticDir = options.agenticDir ?? process.env.AGENTIC_DIR ?? DEFAULT_AGENTIC_DIR;
    this.startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;
  }

  get root(): string {
    return join(this.config.dataDir, 'local-tasks');
  }

  async launch(spec: LaunchSpec): Promise<LaunchResult> {
    // Never a real agent without the gate: refused before anything is made.
    this.command();
    const dir = join(this.root, spec.taskId);
    const work = join(dir, 'work');
    const fakeAgent = this.config.localAgent === 'fake' ? findFakeAgent() : '';
    let finish: () => void = () => undefined;
    // Registered before the clone, so a stop or remove during the launch finds the task.
    const task: LocalTask = {
      port: 0, dir, env: {}, log: '', launching: true, cancelled: false, stopping: false, scheduled: spec.scheduled !== undefined,
      launchDone: new Promise<void>((resolveDone) => { finish = resolveDone; }),
    };
    this.tasks.set(spec.taskId, task);
    try {
      for (const sub of ['task', 'agent-state', 'state']) await mkdir(join(dir, sub), { recursive: true });
      this.throwIfCancelled(task);
      await this.clone(spec, dir, work, task);
      this.throwIfCancelled(task);
      const port = await freePort();
      this.throwIfCancelled(task);
      task.port = port;
      task.env = { ...bridgeEnv({ config: this.config, spec, taskDir: dir, workDir: work, port, path: process.env.PATH, fakeAgent }), ...this.stepsEnv(dir) };
      const child = this.spawnBridge(spec.taskId, task);
      // A failing start step ends the launch here, with its message, not as a bridge that never answers.
      if (this.entrypoint()) await this.awaitUp(task, child);
      task.launching = false;
      return { bridgeUrl: this.bridgeUrl(task) };
    } catch (error) {
      task.launching = false;
      await this.kill(task).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
      if (this.tasks.get(spec.taskId) === task) this.tasks.delete(spec.taskId);
      throw error;
    } finally {
      finish();
    }
  }

  // Respawns the bridge on the same port, so the bridge URL the service keeps stays valid.
  // Not the bridge of a scheduled run that ended normally (exit 0 after a final state): that run is over.
  async start(taskId: string): Promise<void> {
    const task = this.must(taskId);
    if (task.launching || this.alive(task)) return;
    if (task.scheduled && task.child?.exitCode === 0 && (await this.finalState(taskId))) {
      throw new ConflictException(`The scheduled run of task ${taskId} has ended; its bridge is not started again`);
    }
    const child = this.spawnBridge(taskId, task);
    if (this.entrypoint()) await this.awaitUp(task, child);
  }

  async stop(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    await this.cancelLaunch(task);
    await this.kill(task);
  }

  async remove(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    await this.cancelLaunch(task);
    await this.kill(task);
    await rm(task.dir, { recursive: true, force: true });
    if (this.tasks.get(taskId) === task) this.tasks.delete(taskId);
  }

  async inspect(taskId: string): Promise<TaskInspection> {
    const task = this.tasks.get(taskId);
    return { exists: task !== undefined, running: task !== undefined && this.alive(task), bridgeUrl: task && task.port ? this.bridgeUrl(task) : '' };
  }

  async countRunning(): Promise<number> {
    return [...this.tasks.values()].filter((t) => this.alive(t)).length;
  }

  async readLedger(taskId: string): Promise<string | undefined> {
    const file = join(this.root, taskId, 'task', 'ledger.jsonl');
    try {
      if ((await stat(file)).size > LEDGER_MAX_BYTES) {
        this.logger.warn(`The cost ledger of task ${taskId} is over ${LEDGER_MAX_BYTES} bytes and is not read`);
        return undefined;
      }
      return await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async readTaskFile(taskId: string, name: TaskFileName): Promise<string | null> {
    assertTaskFileName(name);
    const file = join(this.root, taskId, 'task', name);
    try {
      const info = await lstat(file);
      if (!info.isFile()) throw new Error(`${name} is not a regular file`);
      if (info.size > TASK_FILE_MAX_BYTES) throw new WorktreeFileTooLargeError(name, taskId, TASK_FILE_MAX_BYTES);
      return await readFile(file, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      throw error;
    }
  }

  // The agent's /work is <task dir>/work here; the bridge (AGENTIC_WORKTREE=1) runs it in the task's own worktree
  // <work>/.worktrees/<task id> (the image's task/worktree.sh), so that is where the files are.
  async hasFiles(taskId: string, paths: string[]): Promise<Record<string, boolean>> {
    assertWorktreePaths(paths);
    const work = join(this.root, taskId, 'work', '.worktrees', taskId);
    const result: Record<string, boolean> = {};
    for (const path of paths) {
      try {
        await stat(join(work, path));
        result[path] = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
        result[path] = false;
      }
    }
    return result;
  }

  async readFile(taskId: string, path: string, maxBytes: number): Promise<string | null> {
    assertWorktreePaths([path]);
    const file = join(this.root, taskId, 'work', '.worktrees', taskId, path);
    try {
      const info = await lstat(file);
      if (!info.isFile()) throw new Error(`${path} is not a regular file`);
      if (info.size > maxBytes) throw new WorktreeFileTooLargeError(path, taskId, maxBytes);
      return await readFile(file, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      throw error;
    }
  }

  // Whether the bridge's state.json holds a final state (an unreadable or absent one does not).
  private async finalState(taskId: string): Promise<boolean> {
    try {
      const state = (JSON.parse((await this.readTaskFile(taskId, 'state.json')) ?? '{}') as { state?: unknown }).state;
      return typeof state === 'string' && FINAL_STATES.has(state);
    } catch {
      return false;
    }
  }

  // Bridge stdout/stderr so far (the last 64 KiB), for diagnostics.
  output(taskId: string): string {
    return this.tasks.get(taskId)?.log ?? '';
  }

  // Nest calls this on shutdown: no bridge outlives the app. Folders stay.
  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.tasks.values()].map(async (t) => { await this.cancelLaunch(t); await this.kill(t); }));
  }

  private entrypoint(): string | undefined {
    const file = join(this.agenticDir, 'entrypoint.sh');
    return existsSync(file) ? file : undefined;
  }

  // What to spawn: the image's entrypoint, which runs the start steps and then the bridge. Without
  // it only the fake agent may run (a plain host); Claude is refused.
  private command(): { file: string; args: string[] } {
    const entrypoint = this.entrypoint();
    if (entrypoint) return { file: entrypoint, args: [this.bridgeCommand] };
    if (this.config.localAgent !== 'fake') {
      throw new Error(`The local launcher with ENGINE_LOCAL_AGENT=${this.config.localAgent} needs the project image: ${join(this.agenticDir, 'entrypoint.sh')} was not found, and a real agent never runs without the gate`);
    }
    return { file: this.bridgeCommand, args: [] };
  }

  // Start-step settings for the local paths: nothing leaves the task folder (no /workspaces, no /agentic-config).
  private stepsEnv(dir: string): Record<string, string> {
    return { AGENTIC_DIR: this.agenticDir, AGENTIC_WORKSPACES_DIR: join(dir, 'workspaces'), AGENTIC_CONFIG_MOUNT: join(dir, 'no-config') };
  }

  // Resolves when the bridge answers (booted); rejects when the process ends first (the
  // entrypoint stops at a failed start step, so the bridge never starts) or the launch is cancelled.
  // A bridge that is slow beyond the timeout is left to the service's own wait.
  private async awaitUp(task: LocalTask, child: ChildProcess): Promise<void> {
    task.awaitingUp = true;
    try {
      await this.pollUp(task, child);
    } finally {
      task.awaitingUp = false;
    }
  }

  private async pollUp(task: LocalTask, child: ChildProcess): Promise<void> {
    const deadline = Date.now() + this.startTimeoutMs;
    while (Date.now() < deadline) {
      this.throwIfCancelled(task);
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
        // A descendant that holds the pipes must not hang the launch: take the group, then wait briefly.
        signalGroup(child, 'SIGKILL');
        await Promise.race([task.closed, new Promise((r) => setTimeout(r, 2000))]);
        if (task.stopping || task.cancelled) throw new Error('The task was stopped or removed while its bridge was starting');
        throw new Error(`The task's start steps failed (${child.signalCode ? `signal ${child.signalCode}` : `exit code ${child.exitCode}`}): ${this.failureLines(task)}`);
      }
      if (await this.answering(task)) return;
      await new Promise((r) => setTimeout(r, START_POLL_MS));
    }
    this.logger.warn(`The bridge of a local task did not answer within ${Math.round(this.startTimeoutMs / 1000)}s`);
  }

  // The bridge listens before it has booted (worktree, state), and answers 503 until it is ready.
  private async answering(task: LocalTask): Promise<boolean> {
    try {
      const response = await fetch(`${this.bridgeUrl(task)}/status`, {
        headers: { authorization: `Bearer ${task.env.AGENTIC_TASK_TOKEN}` }, signal: AbortSignal.timeout(START_POLL_MS * 10),
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private failureLines(task: LocalTask): string {
    // Step output can echo the environment: known secret values and URL credentials are masked.
    const secrets = ['CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN', 'AGENTIC_TASK_TOKEN', 'AGENTIC_AGENT_TOKEN'].map((k) => task.env[k]).filter((v): v is string => !!v);
    const scrub = (line: string) => secrets.reduce((l, v) => l.split(v).join('***'), line).replace(/\/\/[^/@\s]*@/g, '//').slice(0, 300);
    const lines = task.log.split('\n').map((l) => scrub(l.trim())).filter((l) => l !== '');
    return lines.slice(-FAILURE_LINES).join(' | ') || 'no output';
  }

  private bridgeUrl(task: LocalTask): string {
    return `http://127.0.0.1:${task.port}`;
  }

  private throwIfCancelled(task: LocalTask): void {
    if (task.cancelled) throw new Error('The task was stopped or removed while it was being launched');
  }

  // A stop or remove during launch: the launch fails without spawning a bridge and cleans up its folder.
  private async cancelLaunch(task: LocalTask): Promise<void> {
    if (!task.launching) return;
    task.cancelled = true;
    if (task.cloneChild) signalGroup(task.cloneChild, 'SIGKILL');
    await task.launchDone;
  }

  private clone(spec: LaunchSpec, dir: string, work: string, task: LocalTask): Promise<void> {
    const args = ['clone', '--quiet', ...(spec.repoRef ? ['--branch', spec.repoRef] : []), '--', spec.repoUrl, work];
    return new Promise((done, fail) => {
      const child = spawn(this.gitCommand, args, { env: cloneEnv(this.config, spec, dir, process.env.PATH), cwd: dir, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
      task.cloneChild = child;
      let err = '';
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; signalGroup(child, 'SIGKILL'); }, this.cloneTimeoutMs);
      child.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-LOG_LIMIT); });
      child.on('error', (e) => { clearTimeout(timer); fail(new Error(`git clone could not start: ${e.message}`)); });
      child.on('close', (code) => {
        clearTimeout(timer);
        task.cloneChild = undefined;
        if (code === 0) done();
        else if (timedOut) fail(new Error(`git clone timed out after ${Math.round(this.cloneTimeoutMs / 1000)}s`));
        else if (task.cancelled) fail(new Error('git clone was cancelled'));
        else fail(new Error(`git clone failed: ${err.replace(/\/\/[^/@\s]*@/g, '//').trim()}`));
      });
    });
  }

  private spawnBridge(taskId: string, task: LocalTask): ChildProcess {
    const { file, args } = this.command();
    task.log = '';
    task.awaitingUp = this.entrypoint() !== undefined;
    const child = spawn(file, args, { env: task.env, cwd: task.dir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const append = (d: Buffer) => { task.log = (task.log + d.toString()).slice(-LOG_LIMIT); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    // A missing agentic-bridge: keep the reason in the log; the service sees a task that never comes up.
    child.on('error', (error) => { task.log = (task.log + `spawn failed: ${error.message}\n`).slice(-LOG_LIMIT); });
    child.on('exit', (code, signal) => {
      if (task.stopping || task.awaitingUp || task.child !== child) return;
      // The bridge of a scheduled run exits by itself (code 0) once the run is over: that is its normal end.
      if (task.scheduled && code === 0) {
        this.logger.log(`The bridge of task ${taskId} exited after its scheduled run ended`);
        return;
      }
      this.logger.warn(`The bridge of task ${taskId} exited unexpectedly (${signal ? `signal ${signal}` : `code ${code}`})`);
    });
    task.closed = new Promise<void>((done) => { child.once('close', () => done()); });
    task.stopping = false;
    task.child = child;
    return child;
  }

  private alive(task: LocalTask): boolean {
    return task.child !== undefined && task.child.exitCode === null && task.child.signalCode === null;
  }

  // SIGTERM to the bridge's process group, SIGKILL after a grace period; once the bridge is gone,
  // a last SIGKILL takes whatever it left in the group.
  private async kill(task: LocalTask): Promise<void> {
    const child = task.child;
    if (!child) return;
    if (!this.alive(task)) {
      signalGroup(child, 'SIGKILL'); // what a dead leader left behind
      return;
    }
    task.stopping = true;
    const exited = new Promise<void>((done) => {
      child.once('exit', () => done());
      if (child.exitCode !== null || child.signalCode !== null) done();
    });
    signalGroup(child, 'SIGTERM');
    const timer = setTimeout(() => signalGroup(child, 'SIGKILL'), KILL_TIMEOUT_MS);
    await exited;
    clearTimeout(timer);
    signalGroup(child, 'SIGKILL');
  }

  private must(taskId: string): LocalTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`No local task ${taskId}`);
    return task;
  }
}
