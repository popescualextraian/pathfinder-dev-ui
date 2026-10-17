import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LaunchResult, LaunchSpec, TaskInspection, TaskLauncher } from '../../src/service/tasks/task-launcher';

export const FAKE_AGENT = resolve(__dirname, '../../../tools/fake-agent/fake-agent.mjs');

// True when the real bridge executable is on PATH.
export function bridgeAvailable(): boolean {
  return spawnSync('sh', ['-c', 'command -v agentic-bridge'], { encoding: 'utf8' }).status === 0;
}

export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolvePort(port));
    });
  });
}

interface LocalTask {
  port: number;
  dir: string;
  env: NodeJS.ProcessEnv;
  child?: ChildProcess;
  log: string;
}

// A TaskLauncher for tests: the "container" is a real `agentic-bridge` child process on a free
// loopback port, with the fake agent as its ACP command, a temp task dir and a temp git checkout
// (so the bridge's real worktree step runs). Uses the tokens, prompt and branch of the LaunchSpec.
export class LocalProcessLauncher implements TaskLauncher {
  private root?: string;
  private readonly tasks = new Map<string, LocalTask>();

  async launch(spec: LaunchSpec): Promise<LaunchResult> {
    this.root ??= mkdtempSync(join(tmpdir(), 'engine-bridge-'));
    const dir = join(this.root, spec.taskId);
    const work = join(dir, 'work');
    for (const sub of ['task', 'work', 'agent-state', 'state']) mkdirSync(join(dir, sub), { recursive: true });
    const git = (...args: string[]) => {
      const r = spawnSync('git', ['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
    };
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'initial');
    const port = await freePort();
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: dir,
      AGENTIC_TASK_TOKEN: spec.taskToken,
      AGENTIC_AGENT_TOKEN: spec.agentToken,
      AGENTIC_TASK_ID: spec.taskId,
      AGENTIC_PROJECT: 'bridge-test',
      AGENTIC_TASK_DIR: join(dir, 'task'),
      AGENTIC_PROMPT: spec.prompt,
      AGENTIC_WORKTREE: '1',
      AGENTIC_BRANCH: spec.branch,
      AGENTIC_WORK: work,
      AGENTIC_STATE: join(dir, 'state'),
      AGENTIC_EVENTS_DIR: join(dir, 'no-events'),
      AGENTIC_BRIDGE_PORT: String(port),
      AGENTIC_BRIDGE_HOSTS: 'localhost',
      AGENTIC_ACP_CMD: JSON.stringify(['node', FAKE_AGENT]),
      FAKE_AGENT_STATE: join(dir, 'agent-state'),
    };
    if (spec.model) env.AGENTIC_MODEL = spec.model;
    const task: LocalTask = { port, dir, env, log: '' };
    this.tasks.set(spec.taskId, task);
    this.spawnBridge(task);
    return { bridgeUrl: `http://127.0.0.1:${port}` };
  }

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
    rmSync(task.dir, { recursive: true, force: true });
    this.tasks.delete(taskId);
  }

  async inspect(taskId: string): Promise<TaskInspection> {
    const task = this.tasks.get(taskId);
    return { exists: task !== undefined, running: task !== undefined && this.alive(task), bridgeUrl: task ? `http://127.0.0.1:${task.port}` : '' };
  }

  async countRunning(): Promise<number> {
    return [...this.tasks.values()].filter((t) => this.alive(t)).length;
  }

  // Bridge stderr/stdout so far, for failure diagnostics.
  output(taskId: string): string {
    return this.tasks.get(taskId)?.log ?? '';
  }

  // Kills every bridge and removes all temp dirs.
  async dispose(): Promise<void> {
    await Promise.all([...this.tasks.values()].map((t) => this.kill(t)));
    if (this.root) rmSync(this.root, { recursive: true, force: true });
    this.tasks.clear();
  }

  private spawnBridge(task: LocalTask): void {
    const child = spawn('agentic-bridge', [], { env: task.env, cwd: task.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d: Buffer) => { task.log += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { task.log += d.toString(); });
    // A missing or non-executable agentic-bridge: keep the reason in the log, let the test fail on it.
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
      if (child.exitCode !== null || child.signalCode !== null) done(); // exited since the alive() check
    });
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }

  private must(taskId: string): LocalTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`No local task ${taskId}`);
    return task;
  }
}


// describe, or describe.skip with a visible message when the real bridge is not installed.
export function describeWithBridge(name: string, fn: () => void): void {
  if (bridgeAvailable()) {
    describe(name, fn);
  } else {
    process.stderr.write(`SKIPPED "${name}": agentic-bridge is not on PATH\n`);
    describe.skip(name, fn);
  }
}

// Polls until check() returns a value; fails with `what` after timeoutMs.
export async function until<T>(what: string, check: () => Promise<T | undefined | false>, timeoutMs = 20000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
