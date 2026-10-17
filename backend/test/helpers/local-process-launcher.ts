import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { LocalTaskLauncher } from '../../src/integration/tasks/launcher/local-task-launcher';
import { LaunchResult, LaunchSpec } from '../../src/service/tasks/task-launcher';

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

// A LocalTaskLauncher for the bridge tests: fake agent, a temp data dir and one temp git
// checkout that every task clones (whatever repoUrl the spec names), so the bridge's real
// worktree step runs.
export class LocalProcessLauncher extends LocalTaskLauncher {
  private origin?: string;

  constructor() {
    super({ dataDir: mkdtempSync(join(tmpdir(), 'engine-bridge-')), project: 'bridge-test', localAgent: 'fake', claudeCodeOauthToken: '', ghToken: '', gitName: '', gitEmail: '' });
  }

  override async launch(spec: LaunchSpec): Promise<LaunchResult> {
    return super.launch({ ...spec, repoUrl: this.checkout() });
  }

  // Kills every bridge and removes all temp dirs.
  async dispose(): Promise<void> {
    await this.onModuleDestroy();
    rmSync(dirname(this.root), { recursive: true, force: true }); // the data dir, with the checkout in it
  }

  private checkout(): string {
    if (!this.origin) {
      this.origin = join(dirname(this.root), 'origin');
      mkdirSync(this.origin);
      const git = (...args: string[]) => {
        const r = spawnSync('git', ['-C', this.origin as string, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
      };
      git('init', '-q');
      git('commit', '-q', '--allow-empty', '-m', 'initial');
    }
    return this.origin;
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
