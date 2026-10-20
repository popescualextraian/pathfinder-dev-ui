import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeWithBridge, LocalProcessLauncher } from '../helpers/local-process-launcher';

const HOOK = '/opt/agentic/task/hook.sh';

// The local launcher starts the real bridge through the image's entrypoint: the start steps run
// for real (seed, hooks), so a local task gets the gate and the plugins of a Docker task.
// Needs the image (agentic-bridge and /opt/agentic); skipped without agentic-bridge.
describeWithBridge('local task start steps (real entrypoint)', () => {
  const launcher = new LocalProcessLauncher();
  const taskId = 'T-20261020-st01';
  const spec = () => ({
    taskId, taskToken: randomBytes(16).toString('hex'), agentToken: randomBytes(16).toString('hex'),
    prompt: 'hello', repoUrl: 'https://example.invalid/r.git', branch: `agentic/${taskId}`,
  });
  const home = () => join(launcher.root, taskId, 'task', 'home', 'claude');
  const settings = () => JSON.parse(readFileSync(join(home(), 'settings.json'), 'utf8')) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
  const hookBlocks = () => Object.values(settings().hooks).flat().flatMap((g) => g.hooks).filter((h) => h.command.includes(HOOK));

  afterAll(() => launcher.dispose());

  it('installs the gate hook into the task-home settings.json', async () => {
    await launcher.launch(spec());
    expect(existsSync(join(home(), 'settings.json'))).toBe(true);
    const events = Object.keys(settings().hooks);
    expect(events).toEqual(expect.arrayContaining(['PreToolUse', 'PostToolUse', 'Stop']));
    expect(hookBlocks().length).toBe(events.length);
    expect(hookBlocks()[0].command).toBe(`bash ${HOOK} claude sessionstart`);
  });

  it('links the plugins of the setup lines', () => {
    const link = join(home(), 'plugins');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe('/opt/agentic/seed/claude/plugins');
    expect(existsSync(join(link, 'installed_plugins.json'))).toBe(true);
  });

  it('a respawn leaves exactly one hook block per event', async () => {
    const before = hookBlocks().length;
    await launcher.stop(taskId);
    await launcher.start(taskId);
    await launcher.stop(taskId);
    await launcher.start(taskId);
    expect(hookBlocks().length).toBe(before);
    expect(readlinkSync(join(home(), 'plugins'))).toBe('/opt/agentic/seed/claude/plugins');
  });

  it('a start step that fails fails the respawn, with its message', async () => {
    await launcher.stop(taskId);
    writeFileSync(join(home(), 'settings.json'), '{ not json');
    await expect(launcher.start(taskId)).rejects.toThrow(/start steps failed.*not valid JSON/);
    await launcher.remove(taskId);
  });

  it('a start step that fails fails the first launch and leaves nothing behind', async () => {
    const image = brokenImage();
    const broken = new LocalProcessLauncher({ agenticDir: image });
    try {
      await expect(broken.launch({ ...spec(), taskId: 'T-20261020-st02' })).rejects.toThrow(/start steps failed.*start step 50-broken failed/);
      expect(existsSync(join(broken.root, 'T-20261020-st02'))).toBe(false);
    } finally {
      await broken.dispose();
      rmSync(image, { recursive: true, force: true });
    }
  });
});

// A copy of /opt/agentic in which only start.d differs: the real steps plus one that fails.
function brokenImage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'broken-image-'));
  for (const entry of readdirSync('/opt/agentic')) if (entry !== 'start.d') symlinkSync(join('/opt/agentic', entry), join(dir, entry));
  cpSync('/opt/agentic/start.d', join(dir, 'start.d'), { recursive: true });
  writeFileSync(join(dir, 'start.d', '50-broken.sh'), '#!/usr/bin/env bash\necho "broken on purpose" >&2\nexit 1\n');
  return dir;
}
