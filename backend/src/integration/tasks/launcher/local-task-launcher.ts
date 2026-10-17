import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { EngineConfig } from '../../../commons/engine-config';
import { LaunchResult, LaunchSpec, TaskInspection, TaskLauncher } from '../../../service/tasks/task-launcher';
import { gitCredentialEnv } from './git-credential-env';

type LauncherConfig = Pick<
  EngineConfig,
  'dataDir' | 'project' | 'localAgent' | 'claudeCodeOauthToken' | 'ghToken' | 'gitName' | 'gitEmail'
>;

const FAKE_AGENT_RELATIVE = join('tools', 'fake-agent', 'fake-agent.mjs');
const KILL_TIMEOUT_MS = 5000;

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
    AGENTIC_PROMPT: spec.prompt,
    AGENTIC_WORKTREE: '1',
    AGENTIC_BRANCH: spec.branch,
    AGENTIC_WORK: workDir,
    AGENTIC_STATE: join(taskDir, 'state'),
    AGENTIC_EVENTS_DIR: join(taskDir, 'no-events'),
    AGENTIC_BRIDGE_PORT: String(port),
  };
  if (spec.model) env.AGENTIC_MODEL = spec.model;
  if (config.localAgent === 'fake') {
    env.AGENTIC_ACP_CMD = JSON.stringify(['node', fakeAgent]);
    env.FAKE_AGENT_STATE = join(taskDir, 'agent-state');
    return env;
  }
  env.AGENTIC_ALLOWED_ACTIONS = 'push';
  env.CLAUDE_CODE_OAUTH_TOKEN = config.claudeCodeOauthToken;
  if (config.ghToken) env.GH_TOKEN = config.ghToken;
  if (config.gitName) Object.assign(env, { GIT_AUTHOR_NAME: config.gitName, GIT_COMMITTER_NAME: config.gitName });
  if (config.gitEmail) Object.assign(env, { GIT_AUTHOR_EMAIL: config.gitEmail, GIT_COMMITTER_EMAIL: config.gitEmail });
  return { ...env, ...gitCredentialEnv(spec.repoUrl) };
}

// The environment of the clone the launcher itself runs: never prompts; with a push token the
// credential helper references GH_TOKEN (the token is in no URL, argument or file).
export function cloneEnv(config: Pick<LauncherConfig, 'ghToken'>, spec: Pick<LaunchSpec, 'repoUrl'>, taskDir: string, path: string | undefined): Record<string, string> {
  return {
    ...(path ? { PATH: path } : {}),
    HOME: taskDir,
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
    ...(config.ghToken ? { GH_TOKEN: config.ghToken, ...gitCredentialEnv(spec.repoUrl) } : {}),
  };
}

interface LocalTask {
  port: number;
  dir: string;
  env: Record<string, string>;
  child?: ChildProcess;
  log: string;
}

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

// Development only: a task is an `agentic-bridge` child process in this container, in its own
// folder under <dataDir>/local-tasks, on its own loopback port. No isolation between tasks.
// (The bridge itself listens on all interfaces; its tokens protect it.)
export class LocalTaskLauncher implements TaskLauncher {
  private readonly tasks = new Map<string, LocalTask>();

  constructor(private readonly config: LauncherConfig) {}

  get root(): string {
    return join(this.config.dataDir, 'local-tasks');
  }

  async launch(spec: LaunchSpec): Promise<LaunchResult> {
    const dir = join(this.root, spec.taskId);
    const work = join(dir, 'work');
    const fakeAgent = this.config.localAgent === 'fake' ? findFakeAgent() : '';
    try {
      for (const sub of ['task', 'agent-state', 'state']) await mkdir(join(dir, sub), { recursive: true });
      await this.clone(spec, dir, work);
      const port = await freePort();
      const env = bridgeEnv({ config: this.config, spec, taskDir: dir, workDir: work, port, path: process.env.PATH, fakeAgent });
      const task: LocalTask = { port, dir, env, log: '' };
      this.tasks.set(spec.taskId, task);
      this.spawnBridge(task);
      return { bridgeUrl: this.bridgeUrl(task) };
    } catch (error) {
      await this.remove(spec.taskId).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }

  // Respawns the bridge on the same port, so the bridge URL the service keeps stays valid.
  async start(taskId: string): Promise<void> {
    const task = this.must(taskId);
    if (!this.alive(task)) this.spawnBridge(task);
  }

  async stop(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) await this.kill(task);
  }

  async remove(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    await this.kill(task);
    await rm(task.dir, { recursive: true, force: true });
    this.tasks.delete(taskId);
  }

  async inspect(taskId: string): Promise<TaskInspection> {
    const task = this.tasks.get(taskId);
    return { exists: task !== undefined, running: task !== undefined && this.alive(task), bridgeUrl: task ? this.bridgeUrl(task) : '' };
  }

  async countRunning(): Promise<number> {
    return [...this.tasks.values()].filter((t) => this.alive(t)).length;
  }

  // Bridge stdout/stderr so far, for diagnostics.
  output(taskId: string): string {
    return this.tasks.get(taskId)?.log ?? '';
  }

  // Nest calls this on shutdown: no bridge outlives the app. Folders stay.
  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.tasks.values()].map((t) => this.kill(t)));
  }

  private bridgeUrl(task: LocalTask): string {
    return `http://127.0.0.1:${task.port}`;
  }

  private clone(spec: LaunchSpec, dir: string, work: string): Promise<void> {
    const args = ['clone', '--quiet', ...(spec.repoRef ? ['--branch', spec.repoRef] : []), '--', spec.repoUrl, work];
    return new Promise((done, fail) => {
      const child = spawn('git', args, { env: cloneEnv(this.config, spec, dir, process.env.PATH), cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
      child.on('error', (e) => fail(new Error(`git clone could not start: ${e.message}`)));
      child.on('close', (code) => {
        if (code === 0) done();
        else fail(new Error(`git clone failed: ${err.replace(/\/\/[^/@\s]*@/g, '//').trim()}`));
      });
    });
  }

  private spawnBridge(task: LocalTask): void {
    const child = spawn('agentic-bridge', [], { env: task.env, cwd: task.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d: Buffer) => { task.log += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { task.log += d.toString(); });
    // A missing agentic-bridge: keep the reason in the log; the service sees a task that never comes up.
    child.on('error', (error) => { task.log += `spawn failed: ${error.message}\n`; });
    task.child = child;
  }

  private alive(task: LocalTask): boolean {
    return task.child !== undefined && task.child.exitCode === null && task.child.signalCode === null;
  }

  private async kill(task: LocalTask): Promise<void> {
    const child = task.child;
    if (!child || !this.alive(task)) return;
    const exited = new Promise<void>((done) => {
      child.once('exit', () => done());
      if (child.exitCode !== null || child.signalCode !== null) done();
    });
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), KILL_TIMEOUT_MS);
    await exited;
    clearTimeout(timer);
  }

  private must(taskId: string): LocalTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`No local task ${taskId}`);
    return task;
  }
}
