import { BadRequestException, Logger } from '@nestjs/common';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bridgeEnv, cloneEnv, findFakeAgent, LocalTaskLauncher } from '../../../../../src/engine/integration/launcher/local-task-launcher';
import { LEDGER_MAX_BYTES, LaunchSpec, TASK_FILE_MAX_BYTES, WorktreeFileTooLargeError } from '../../../../../src/engine/service/task-launcher';

const OAUTH = 'made-up-oauth-token-111';
const GH = 'made-up-gh-token-222';
const TASK_TOKEN = 'made-up-task-token-aaaa';
const AGENT_TOKEN = 'made-up-agent-token-bbbb';

const spec: LaunchSpec = {
  taskId: 'T-1', taskToken: TASK_TOKEN, agentToken: AGENT_TOKEN, prompt: 'do it', repoUrl: 'https://github.com/acme/r.git', branch: 'agentic/T-1', model: 'm1',
};
// A folder without entrypoint.sh: a host without the image.
const NO_IMAGE = '/nonexistent-agentic-dir';
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
      AGENTIC_TASK_DIR: '/data/local-tasks/T-1/task', AGENTIC_COST_LEDGER_DIR: '/data/local-tasks/T-1/task', AGENTIC_GATE: '1',
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

  const launcherFor = () => new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { agenticDir: NO_IMAGE });
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
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { bridgeCommand: bridge, agenticDir: NO_IMAGE });
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
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { bridgeCommand: bridge, agenticDir: NO_IMAGE });
    await l.launch({ ...spec, repoUrl: origin });
    await waitFor('grandchild pid', () => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    await l.onModuleDestroy();
    await waitFor('grandchild exit', () => !alive(pid));
  });

  it('times out a hanging clone with a clear message, killing git, and cleans up', async () => {
    const git = script('slow-git.sh', 'sleep 300');
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { gitCommand: git, cloneTimeoutMs: 300, agenticDir: NO_IMAGE });
    await expect(l.launch({ ...spec, repoUrl: 'https://user:s3cret@example.invalid/a/b.git' })).rejects.toThrow(/git clone timed out after/);
    expect(existsSync(join(l.root, 'T-1'))).toBe(false);
    expect(await l.inspect('T-1')).toMatchObject({ exists: false });
  });

  it.each(['stop', 'remove'] as const)('%s during the clone cancels the launch: no bridge, no folder', async (action) => {
    const marker = join(tmp, 'bridge-started');
    const git = script('slow-git.sh', 'sleep 300');
    const bridge = script('bridge.sh', `touch ${marker}\nsleep 300`);
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { gitCommand: git, bridgeCommand: bridge, agenticDir: NO_IMAGE });
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

  describe('through the image entrypoint', () => {
    // A stand-in image: entrypoint.sh records what it was run with, then plays the bridge by
    // answering on the bridge port (or fails like a failed start step).
    const image = (body: string) => {
      const dir = join(tmp, 'image');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'entrypoint.sh');
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
      return dir;
    };
    const listen = `echo "$@" > "$AGENTIC_STATE/args"; env > "$AGENTIC_STATE/env.txt"; exec node -e 'require("http").createServer((q,r)=>r.end("{}")).listen(Number(process.env.AGENTIC_BRIDGE_PORT),"127.0.0.1")'`;
    const launcher = (agenticDir: string, localAgent: 'fake' | 'claude' = 'fake') =>
      new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent, claudeCodeOauthToken: OAUTH }, { agenticDir, bridgeCommand: 'agentic-bridge', startTimeoutMs: 5000 });

    it('spawns the entrypoint with agentic-bridge and AGENTIC_GATE=1', async () => {
      const l = launcher(image(listen));
      await l.launch({ ...spec, repoUrl: origin });
      const state = join(l.root, 'T-1', 'state');
      expect(readFileSync(join(state, 'args'), 'utf8').trim()).toBe('agentic-bridge');
      const env = readFileSync(join(state, 'env.txt'), 'utf8');
      expect(env).toContain('AGENTIC_GATE=1');
      expect(env).toContain(`AGENTIC_TASK_DIR=${join(l.root, 'T-1', 'task')}`);
      expect(env).toContain(`AGENTIC_WORKSPACES_DIR=${join(l.root, 'T-1', 'workspaces')}`);
      await l.remove('T-1');
    });

    it('refuses Claude without an entrypoint, before anything is made', async () => {
      const l = launcher(NO_IMAGE, 'claude');
      await expect(l.launch({ ...spec, repoUrl: origin })).rejects.toThrow(/needs the project image.*never runs without the gate/);
      expect(existsSync(join(l.root, 'T-1'))).toBe(false);
    });

    it('spawns the fake agent directly without an entrypoint', async () => {
      const bridge = script('bridge.sh', 'echo "gate=$AGENTIC_GATE" > "$AGENTIC_STATE/direct"\nsleep 300');
      const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { agenticDir: NO_IMAGE, bridgeCommand: bridge });
      await l.launch({ ...spec, repoUrl: origin });
      await waitFor('direct marker', () => existsSync(join(l.root, 'T-1', 'state', 'direct')));
      expect(readFileSync(join(l.root, 'T-1', 'state', 'direct'), 'utf8').trim()).toBe('gate=1');
      await l.remove('T-1');
    });

    it('fails the launch with the step message when the entrypoint exits non-zero, and cleans up', async () => {
      const l = launcher(image('echo "agentic: start step 45-hooks failed (rc=1)" >&2\nexit 1'));
      await expect(l.launch({ ...spec, repoUrl: origin })).rejects.toThrow(/start steps failed \(exit code 1\).*45-hooks failed/);
      expect(existsSync(join(l.root, 'T-1'))).toBe(false);
      expect(await l.inspect('T-1')).toMatchObject({ exists: false });
    });

    it('masks secrets and URL credentials in the failure message', async () => {
      const l = launcher(image(`echo "token $CLAUDE_CODE_OAUTH_TOKEN $AGENTIC_TASK_TOKEN https://u:pw@host/x" >&2\nexit 1`), 'claude');
      const error = await l.launch({ ...spec, repoUrl: origin }).catch((e: Error) => e);
      expect((error as Error).message).toContain('start steps failed');
      for (const secret of [OAUTH, TASK_TOKEN, 'u:pw']) expect((error as Error).message).not.toContain(secret);
    });

    it('stop during the start wait cancels the launch and kills the entrypoint', async () => {
      const l = launcher(image('sleep 300'));
      const outcome = l.launch({ ...spec, repoUrl: origin }).then(() => 'launched', (e: Error) => e.message);
      await waitFor('state folder', () => existsSync(join(l.root, 'T-1', 'state')));
      await new Promise((r) => setTimeout(r, 500));
      await l.stop('T-1');
      expect(await outcome).toMatch(/stopped or removed/);
      expect(await l.countRunning()).toBe(0);
    });

    it('respawns through the entrypoint, and fails the respawn with the message when a step fails', async () => {
      const marker = join(tmp, 'fail-now');
      const dir = image(`if [ -e ${marker} ]; then echo "agentic: seed broke" >&2; exit 1; fi\n${listen}`);
      const l = launcher(dir);
      await l.launch({ ...spec, repoUrl: origin });
      await l.stop('T-1');
      await l.start('T-1');
      expect(await l.countRunning()).toBe(1);
      await l.stop('T-1');
      writeFileSync(marker, '');
      await expect(l.start('T-1')).rejects.toThrow(/seed broke/);
      await l.remove('T-1');
    });
  });

  it('keeps only the tail of the bridge output', async () => {
    const bridge = script('bridge.sh', 'head -c 200000 /dev/zero | tr "\\0" x\necho END\nsleep 300');
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { bridgeCommand: bridge, agenticDir: NO_IMAGE });
    await l.launch({ ...spec, repoUrl: origin });
    await waitFor('output end', () => l.output('T-1').includes('END'));
    expect(l.output('T-1').length).toBeLessThanOrEqual(64 * 1024);
    await l.remove('T-1');
  });

  describe('the end of a scheduled run', () => {
    // A bridge that ends like a scheduled run: final state.json, then exit with the given code.
    const ending = (code: number, state = 'stopped') =>
      script('bridge.sh', `printf '{"state":"${state}","reason":"scheduled-done"}' > "$AGENTIC_TASK_DIR/state.json"\nexit ${code}`);
    const make = (bridge: string) => new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { bridgeCommand: bridge, agenticDir: NO_IMAGE });

    it('does not respawn the bridge of a scheduled task that exited normally with a final state', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const l = make(ending(0));
      await l.launch({ ...spec, repoUrl: origin, scheduled: { runTimeoutSeconds: 60 } });
      await waitFor('bridge exit', () => existsSync(join(l.root, 'T-1', 'task', 'state.json')));
      for (let i = 0; i < 100 && (await l.inspect('T-1')).running; i++) await new Promise((r) => setTimeout(r, 20));
      expect(await l.inspect('T-1')).toMatchObject({ exists: true, running: false });
      await expect(l.start('T-1')).rejects.toThrow(/scheduled run of task T-1 has ended/);
      expect(await l.countRunning()).toBe(0);
      // A normal end: no warning that it exited unexpectedly, a plain log line.
      expect(warn.mock.calls.map((c) => String(c[0]))).not.toContainEqual(expect.stringContaining('exited unexpectedly'));
      expect(log.mock.calls.map((c) => String(c[0]))).toContainEqual(expect.stringMatching(/T-1 exited after its scheduled run ended/));
      await l.remove('T-1');
      jest.restoreAllMocks();
    });

    it('respawns an ordinary task whose bridge exited the same way', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const l = make(ending(0));
      await l.launch({ ...spec, repoUrl: origin });
      await waitFor('bridge exit', () => existsSync(join(l.root, 'T-1', 'task', 'state.json')));
      for (let i = 0; i < 100 && (await l.inspect('T-1')).running; i++) await new Promise((r) => setTimeout(r, 20));
      await expect(l.start('T-1')).resolves.toBeUndefined();
      await l.remove('T-1');
      jest.restoreAllMocks();
    });

    it('respawns a scheduled task whose bridge crashed (non-zero exit)', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const l = make(ending(3, 'running'));
      await l.launch({ ...spec, repoUrl: origin, scheduled: { runTimeoutSeconds: 60 } });
      await waitFor('bridge exit', () => existsSync(join(l.root, 'T-1', 'task', 'state.json')));
      for (let i = 0; i < 100 && (await l.inspect('T-1')).running; i++) await new Promise((r) => setTimeout(r, 20));
      await expect(l.start('T-1')).resolves.toBeUndefined();
      await l.remove('T-1');
      jest.restoreAllMocks();
    });
  });

  it('warns, without output, when a bridge exits unexpectedly', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const bridge = script('bridge.sh', 'echo secret-output\nexit 3');
    const l = new LocalTaskLauncher({ ...base, dataDir: join(tmp, 'data'), localAgent: 'fake' }, { bridgeCommand: bridge, agenticDir: NO_IMAGE });
    await l.launch({ ...spec, repoUrl: origin });
    await waitFor('warning', () => warn.mock.calls.length > 0);
    expect(String(warn.mock.calls[0][0])).toMatch(/T-1.*exited unexpectedly.*code 3/);
    expect(String(warn.mock.calls[0][0])).not.toContain('secret-output');
    await l.remove('T-1');
    warn.mockRestore();
  });
});

describe('LocalTaskLauncher.readLedger', () => {
  let dataDir: string;
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'ledger-')); });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));
  const launcher = () => new LocalTaskLauncher({ ...base, dataDir, localAgent: 'fake' });
  const ledgerPath = () => join(dataDir, 'local-tasks', 'T-1', 'task', 'ledger.jsonl');

  it('reads <task dir>/task/ledger.jsonl', async () => {
    mkdirSync(join(dataDir, 'local-tasks', 'T-1', 'task'), { recursive: true });
    writeFileSync(ledgerPath(), 'line1\nline2\n');
    await expect(launcher().readLedger('T-1')).resolves.toBe('line1\nline2\n');
  });

  it('returns undefined when the file or the task folder is missing', async () => {
    await expect(launcher().readLedger('T-1')).resolves.toBeUndefined();
  });

  it('returns undefined and logs when the file is over the cap', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    mkdirSync(join(dataDir, 'local-tasks', 'T-1', 'task'), { recursive: true });
    writeFileSync(ledgerPath(), Buffer.alloc(LEDGER_MAX_BYTES + 1, 'x'));
    await expect(launcher().readLedger('T-1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('T-1'));
    warn.mockRestore();
  });
});

describe('LocalTaskLauncher.readFile', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'readfile-'));
    const tree = join(dataDir, 'local-tasks', 'T-1', 'work', '.worktrees', 'T-1');
    mkdirSync(join(tree, 'plans'), { recursive: true });
    writeFileSync(join(tree, 'workflow-draft.yaml'), 'name: x\n');
    writeFileSync(join(tree, 'plans', 'big.md'), Buffer.alloc(101, 'x'));
    writeFileSync(join(dataDir, 'local-tasks', 'T-1', 'work', 'only-in-clone.md'), 'x');
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));
  const launcher = () => new LocalTaskLauncher({ ...base, dataDir, localAgent: 'fake' });

  it('refuses a symlink and a directory as not a regular file', async () => {
    const tree = join(dataDir, 'local-tasks', 'T-1', 'work', '.worktrees', 'T-1');
    symlinkSync(join(tree, 'workflow-draft.yaml'), join(tree, 'link.yaml'));
    await expect(launcher().readFile('T-1', 'link.yaml', 100)).rejects.toThrow('not a regular file');
    await expect(launcher().readFile('T-1', 'plans', 100)).rejects.toThrow('not a regular file');
  });

  it('reads a file of the task worktree', async () => {
    await expect(launcher().readFile('T-1', 'workflow-draft.yaml', 100)).resolves.toBe('name: x\n');
  });

  it('returns null for a missing file, a file only in the clone, a missing task, and a path through a file', async () => {
    await expect(launcher().readFile('T-1', 'nope.yaml', 100)).resolves.toBeNull();
    await expect(launcher().readFile('T-1', 'only-in-clone.md', 100)).resolves.toBeNull();
    await expect(launcher().readFile('T-9', 'a', 100)).resolves.toBeNull();
    await expect(launcher().readFile('T-1', 'workflow-draft.yaml/x', 100)).resolves.toBeNull();
  });

  it('throws when the file is over maxBytes', async () => {
    const error: unknown = await launcher().readFile('T-1', 'plans/big.md', 100).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorktreeFileTooLargeError);
    expect((error as Error).message).toMatch(/over 100 bytes/);
  });

  it('refuses .. and absolute paths itself', async () => {
    await expect(launcher().readFile('T-1', '../secret.txt', 100)).rejects.toThrow(BadRequestException);
    await expect(launcher().readFile('T-1', '/etc/passwd', 100)).rejects.toThrow(BadRequestException);
  });
});

describe('LocalTaskLauncher.hasFiles', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'hasfiles-'));
    // The bridge (AGENTIC_WORKTREE=1) runs the agent in the task's own worktree <work>/.worktrees/<id>.
    const tree = join(dataDir, 'local-tasks', 'T-1', 'work', '.worktrees', 'T-1');
    mkdirSync(join(tree, 'plans', 'sub'), { recursive: true });
    writeFileSync(join(tree, 'plans', '7.md'), 'x');
    writeFileSync(join(tree, 'plans', 'sub', 'a.txt'), 'x');
    // In the clone, not in the worktree: not what the agent sees.
    writeFileSync(join(dataDir, 'local-tasks', 'T-1', 'work', 'only-in-clone.md'), 'x');
    writeFileSync(join(dataDir, 'local-tasks', 'T-1', 'secret.txt'), 'x');
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));
  const launcher = () => new LocalTaskLauncher({ ...base, dataDir, localAgent: 'fake' });

  it('reports present, missing, nested files and directories in the task worktree', async () => {
    await expect(launcher().hasFiles('T-1', ['plans/7.md', 'plans/8.md', 'plans/sub/a.txt', 'plans', 'only-in-clone.md'])).resolves.toEqual({
      'plans/7.md': true, 'plans/8.md': false, 'plans/sub/a.txt': true, plans: true, 'only-in-clone.md': false,
    });
  });

  it('reports false for everything when the task folder is missing', async () => {
    await expect(launcher().hasFiles('T-9', ['a'])).resolves.toEqual({ a: false });
  });

  it('refuses .. and absolute paths itself', async () => {
    await expect(launcher().hasFiles('T-1', ['../secret.txt'])).rejects.toThrow(BadRequestException);
    await expect(launcher().hasFiles('T-1', [join(dataDir, 'local-tasks', 'T-1', 'secret.txt')])).rejects.toThrow(BadRequestException);
  });
});

describe('bridgeEnv scheduled', () => {
  it('sets AGENTIC_SCHEDULED=1 and AGENTIC_RUN_TIMEOUT only for a scheduled task', () => {
    const env = bridgeEnv(input({}, { ...spec, scheduled: { runTimeoutSeconds: 900 } }));
    expect(env.AGENTIC_SCHEDULED).toBe('1');
    expect(env.AGENTIC_RUN_TIMEOUT).toBe('900');
    const plain = bridgeEnv(input({}));
    expect(plain.AGENTIC_SCHEDULED).toBeUndefined();
    expect(plain.AGENTIC_RUN_TIMEOUT).toBeUndefined();
  });
});

describe('LocalTaskLauncher.readTaskFile', () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'ltf-')); mkdirSync(join(tmp, 'local-tasks', 'T-1', 'task'), { recursive: true }); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));
  const launcher = () => new LocalTaskLauncher({ ...base, dataDir: tmp, localAgent: 'fake' });
  const put = (name: string, text: string) => writeFileSync(join(tmp, 'local-tasks', 'T-1', 'task', name), text);

  it.each(['result.md', 'state.json'] as const)('reads %s from the task dir', async (name) => {
    put(name, 'hello');
    await expect(launcher().readTaskFile('T-1', name)).resolves.toBe('hello');
  });

  it('returns null when the file or the task folder is absent', async () => {
    await expect(launcher().readTaskFile('T-1', 'result.md')).resolves.toBeNull();
    await expect(launcher().readTaskFile('T-9', 'state.json')).resolves.toBeNull();
  });

  it('throws over 64 KB and refuses other names and symlinks', async () => {
    put('result.md', 'x'.repeat(TASK_FILE_MAX_BYTES + 1));
    await expect(launcher().readTaskFile('T-1', 'result.md')).rejects.toBeInstanceOf(WorktreeFileTooLargeError);
    await expect(launcher().readTaskFile('T-1', 'ledger.jsonl' as 'result.md')).rejects.toThrow(BadRequestException);
    writeFileSync(join(tmp, 'secret'), 's');
    symlinkSync(join(tmp, 'secret'), join(tmp, 'local-tasks', 'T-1', 'task', 'state.json'));
    await expect(launcher().readTaskFile('T-1', 'state.json')).rejects.toThrow('not a regular file');
  });
});
