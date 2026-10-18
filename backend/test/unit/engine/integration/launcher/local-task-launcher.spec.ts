import { Logger } from '@nestjs/common';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bridgeEnv, cloneEnv, findFakeAgent, LocalTaskLauncher } from '../../../../../src/engine/integration/launcher/local-task-launcher';
import { LaunchSpec } from '../../../../../src/engine/service/task-launcher';

const OAUTH = 'made-up-oauth-token-111';
const GH = 'made-up-gh-token-222';
const TASK_TOKEN = 'made-up-task-token-aaaa';
const AGENT_TOKEN = 'made-up-agent-token-bbbb';

const spec: LaunchSpec = {
  taskId: 'T-1', taskToken: TASK_TOKEN, agentToken: AGENT_TOKEN, prompt: 'do it', repoUrl: 'https://github.com/acme/r.git', branch: 'agentic/T-1', model: 'm1',
};
const base = { dataDir: '/data', project: 'proj', claudeCodeOauthToken: '', ghToken: '', gitName: '', gitEmail: '' };
const input = (config: object, s: LaunchSpec = spec) => ({
  config: { ...base, localAgent: 'fake' as const, ...config }, spec: s, taskDir: '/data/local-tasks/T-1', workDir: '/data/local-tasks/T-1/work', port: 4321, path: '/usr/bin', fakeAgent: '/repo/tools/fake-agent/fake-agent.mjs',
});

describe('bridgeEnv', () => {
  it('fake agent: explicit variables, the fake agent as ACP command, no secret', () => {
    // Even if the app has tokens configured, the fake agent's bridge gets none.
    const env = bridgeEnv(input({ ghToken: GH, claudeCodeOauthToken: OAUTH, gitName: 'n', gitEmail: 'e@x' }));
    expect(env).toMatchObject({
      PATH: '/usr/bin', HOME: '/data/local-tasks/T-1', AGENTIC_TASK_TOKEN: TASK_TOKEN, AGENTIC_AGENT_TOKEN: AGENT_TOKEN,
      AGENTIC_PROJECT: 'proj', AGENTIC_WORKTREE: '1', AGENTIC_BRANCH: 'agentic/T-1', AGENTIC_BRIDGE_PORT: '4321',
      AGENTIC_WORK: '/data/local-tasks/T-1/work', AGENTIC_MODEL: 'm1', AGENTIC_ALLOWED_ACTIONS: 'push,open-pr',
      AGENTIC_TASK_DIR: '/data/local-tasks/T-1/task', AGENTIC_COST_LEDGER_DIR: '/data/local-tasks/T-1/task',
    });
    expect(JSON.parse(env.AGENTIC_ACP_CMD)).toEqual(['node', '/repo/tools/fake-agent/fake-agent.mjs']);
    const text = JSON.stringify(env);
    expect(text).not.toContain(OAUTH);
    expect(text).not.toContain(GH);
    expect(Object.keys(env).filter((k) => /GH_|OAUTH|GIT_|TOKEN/.test(k)).sort()).toEqual(['AGENTIC_AGENT_TOKEN', 'AGENTIC_TASK_TOKEN']);
  });

  it('claude: default agent, OAuth token, push token, git helper entries and identity', () => {
    const env = bridgeEnv(input({ localAgent: 'claude', claudeCodeOauthToken: OAUTH, ghToken: GH, gitName: 'Bot', gitEmail: 'bot@example.invalid' }));
    expect(env.AGENTIC_ACP_CMD).toBeUndefined();
    expect(env).toMatchObject({
      CLAUDE_CODE_OAUTH_TOKEN: OAUTH, GH_TOKEN: GH, GIT_AUTHOR_NAME: 'Bot', GIT_COMMITTER_NAME: 'Bot',
      GIT_AUTHOR_EMAIL: 'bot@example.invalid', GIT_COMMITTER_EMAIL: 'bot@example.invalid', GIT_CONFIG_COUNT: '4',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper', AGENTIC_ALLOWED_ACTIONS: 'push,open-pr',
    });
    expect(env.GIT_CONFIG_VALUE_1).toContain('GH_TOKEN');
    // The token appears only as the value of GH_TOKEN, never inside another value.
    expect(Object.entries(env).filter(([k, v]) => v.includes(GH) && k !== 'GH_TOKEN')).toEqual([]);
  });

  it('claude with a local path repository: no git credential entries', () => {
    const env = bridgeEnv(input({ localAgent: 'claude', claudeCodeOauthToken: OAUTH }, { ...spec, repoUrl: '/some/checkout' }));
    expect(Object.keys(env).filter((k) => k.startsWith('GIT_CONFIG'))).toEqual([]);
    expect(env.GH_TOKEN).toBeUndefined();
  });
});

describe('cloneEnv', () => {
  it('uses the credential helper only when a push token is configured', () => {
    expect(cloneEnv({ ghToken: '' }, spec, '/d', '/bin')).toEqual({ PATH: '/bin', HOME: '/d', GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' });
    const env = cloneEnv({ ghToken: GH }, spec, '/d', '/bin');
    expect(env).toMatchObject({ GH_TOKEN: GH, GIT_CONFIG_COUNT: '4' });
    expect(Object.entries(env).filter(([k, v]) => v.includes(GH) && k !== 'GH_TOKEN')).toEqual([]);
  });

  it('does not pass the push token to the clone of a local path', () => {
    expect(cloneEnv({ ghToken: GH }, { repoUrl: '/some/checkout' }, '/d', '/bin')).not.toHaveProperty('GH_TOKEN');
  });
});

describe('findFakeAgent', () => {
  it('finds tools/fake-agent from src and from a dist-like location', () => {
    const root = resolve(__dirname, '../../../../../..');
    expect(findFakeAgent()).toBe(join(root, 'tools/fake-agent/fake-agent.mjs'));
    expect(findFakeAgent(join(root, 'dist/backend/engine/integration/launcher'))).toBe(join(root, 'tools/fake-agent/fake-agent.mjs'));
  });
});

describe('LocalTaskLauncher', () => {
  let tmp: string;
  let origin: string;
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'local-launcher-'));
    origin = join(tmp, 'origin');
    mkdirSync(origin);
    git(origin, 'init', '-q', '-b', 'main');
    writeFileSync(join(origin, 'hello.txt'), 'hi');
    git(origin, 'add', '.');
    git(origin, 'commit', '-q', '-m', 'one');
    git(origin, 'branch', 'feature');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const launcherFor = () => new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' });
  // Reaches the private clone step without starting a bridge.
  const clone = (l: LocalTaskLauncher, s: LaunchSpec, dir: string, work: string) =>
    (l as unknown as { clone(s: LaunchSpec, d: string, w: string, t: object): Promise<void> }).clone(s, dir, work, {});

  it('keeps task folders under <dataDir>/local-tasks', () => {
    expect(launcherFor().root).toBe(join(tmp, 'data', 'local-tasks'));
  });

  it('clones a local path into the work folder', async () => {
    const dir = join(tmp, 'task');
    mkdirSync(dir);
    await clone(launcherFor(), { ...spec, repoUrl: origin }, dir, join(dir, 'work'));
    expect(readFileSync(join(dir, 'work', 'hello.txt'), 'utf8')).toBe('hi');
  });

  it('honors repoRef', async () => {
    const dir = join(tmp, 'task');
    mkdirSync(dir);
    await clone(launcherFor(), { ...spec, repoUrl: origin, repoRef: 'feature' }, dir, join(dir, 'work'));
    expect(existsSync(join(dir, 'work', '.git'))).toBe(true);
    expect(spawnSync('git', ['-C', join(dir, 'work'), 'branch', '--show-current'], { encoding: 'utf8' }).stdout.trim()).toBe('feature');
  });

  it('fails clearly on a clone error and cleans the task folder up', async () => {
    const l = launcherFor();
    await expect(l.launch({ ...spec, repoUrl: join(tmp, 'missing') })).rejects.toThrow(/git clone failed/);
    expect(existsSync(join(l.root, 'T-1'))).toBe(false);
    expect(await l.inspect('T-1')).toMatchObject({ exists: false, running: false });
  });

  it('reports nothing for an unknown task and refuses to start it', async () => {
    const l = launcherFor();
    expect(await l.countRunning()).toBe(0);
    await expect(l.start('nope')).rejects.toThrow(/No local task/);
    await l.stop('nope');
    await l.remove('nope');
  });

  const script = (name: string, body: string) => {
    const file = join(tmp, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
    return file;
  };
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const waitFor = async (what: string, check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 50));
    if (!check()) throw new Error(`Timed out waiting for ${what}`);
  };

  it('kills the whole process group of a bridge, grandchildren included', async () => {
    const pidFile = join(tmp, 'grandchild.pid');
    const bridge = script('bridge.sh', `sleep 300 &\necho $! > ${pidFile}\nwait`);
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { bridgeCommand: bridge });
    await l.launch({ ...spec, repoUrl: origin });
    await waitFor('grandchild pid', () => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(alive(pid)).toBe(true);
    await l.stop('T-1');
    await waitFor('grandchild exit', () => !alive(pid));
    await l.remove('T-1');
  });

  it('onModuleDestroy kills a grandchild too', async () => {
    const pidFile = join(tmp, 'grandchild.pid');
    const bridge = script('bridge.sh', `sleep 300 &\necho $! > ${pidFile}\nwait`);
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { bridgeCommand: bridge });
    await l.launch({ ...spec, repoUrl: origin });
    await waitFor('grandchild pid', () => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    await l.onModuleDestroy();
    await waitFor('grandchild exit', () => !alive(pid));
  });

  it('times out a hanging clone with a clear message, killing git, and cleans up', async () => {
    const git = script('slow-git.sh', 'sleep 300');
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { gitCommand: git, cloneTimeoutMs: 300 });
    await expect(l.launch({ ...spec, repoUrl: 'https://user:s3cret@example.invalid/a/b.git' })).rejects.toThrow(/git clone timed out after/);
    expect(existsSync(join(l.root, 'T-1'))).toBe(false);
    expect(await l.inspect('T-1')).toMatchObject({ exists: false });
  });

  it.each(['stop', 'remove'] as const)('%s during the clone cancels the launch: no bridge, no folder', async (action) => {
    const marker = join(tmp, 'bridge-started');
    const git = script('slow-git.sh', 'sleep 300');
    const bridge = script('bridge.sh', `touch ${marker}\nsleep 300`);
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { gitCommand: git, bridgeCommand: bridge });
    const launching = l.launch({ ...spec, repoUrl: origin });
    const outcome = launching.then(() => 'launched', (e: Error) => e.message);
    await waitFor('launch registered', () => existsSync(join(l.root, 'T-1')));
    expect(await l.inspect('T-1')).toMatchObject({ exists: true, running: false });
    await l[action]('T-1');
    expect(await outcome).toMatch(/stopped or removed|cancelled/);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(l.root, 'T-1'))).toBe(false);
    expect(await l.inspect('T-1')).toMatchObject({ exists: false });
  });

  it('keeps only the tail of the bridge output', async () => {
    const bridge = script('bridge.sh', 'head -c 200000 /dev/zero | tr "\\0" x\necho END\nsleep 300');
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { bridgeCommand: bridge });
    await l.launch({ ...spec, repoUrl: origin });
    await waitFor('output end', () => l.output('T-1').includes('END'));
    expect(l.output('T-1').length).toBeLessThanOrEqual(64 * 1024);
    await l.remove('T-1');
  });

  it('warns, without output, when a bridge exits unexpectedly', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const bridge = script('bridge.sh', 'echo secret-output\nexit 3');
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { bridgeCommand: bridge });
    await l.launch({ ...spec, repoUrl: origin });
    await waitFor('warning', () => warn.mock.calls.length > 0);
    expect(String(warn.mock.calls[0][0])).toMatch(/T-1.*exited unexpectedly.*code 3/);
    expect(String(warn.mock.calls[0][0])).not.toContain('secret-output');
    await l.remove('T-1');
    warn.mockRestore();
  });
});
