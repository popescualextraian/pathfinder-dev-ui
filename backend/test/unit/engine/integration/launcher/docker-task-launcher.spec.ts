import Docker from 'dockerode';
import { BadRequestException, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import { EngineConfig } from '../../../../../src/commons/engine-config';
import { DockerTaskLauncher } from '../../../../../src/engine/integration/launcher/docker-task-launcher';
import { gitCredentialEnv } from '../../../../../src/engine/integration/launcher/git-credential-env';
import { LEDGER_MAX_BYTES, LaunchSpec, TASK_FILE_MAX_BYTES, WorktreeFileTooLargeError } from '../../../../../src/engine/service/task-launcher';

const OAUTH = 'made-up-oauth-token-xxxx';
const GH = 'made-up-gh-token-yyyy';
const TASK_TOKEN = 'made-up-task-token-aaaa';
const AGENT_TOKEN = 'made-up-agent-token-bbbb';

const config: EngineConfig = {
  launcher: 'docker',
  localAgent: 'fake',
  image: 'agentic-dev:test',
  dockerNetwork: 'agentic-net',
  dataDir: '/data',
  repoUrl: 'https://github.com/o/default.git',
  allowedRepoHosts: ['github.com'],
  repositories: [{ name: 'default', url: 'https://github.com/o/default.git', default: true }],
  pollSeconds: 15,
  project: 'proj',
  maxRunning: 2,
  claudeCodeOauthToken: OAUTH,
  ghToken: GH,
  gitName: 'Made Up Bot',
  gitEmail: 'made-up-bot@example.invalid',
  taskExtraEnv: {},
  taskExtraBinds: [],
};

const spec: LaunchSpec = {
  taskId: 'T-20261016-ab12',
  taskToken: TASK_TOKEN,
  agentToken: AGENT_TOKEN,
  prompt: 'do the thing',
  repoUrl: 'https://github.com/o/r.git',
  branch: 'agentic/T-20261016-ab12',
};

function dockerError(statusCode: number): Error {
  return Object.assign(new Error(`docker ${statusCode}`), { statusCode });
}

function setup(overrides: Partial<EngineConfig> = {}) {
  const container = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    inspect: jest.fn().mockResolvedValue({ State: { Running: true } }),
    getArchive: jest.fn(),
  };
  const volume = { remove: jest.fn().mockResolvedValue(undefined) };
  const image = { inspect: jest.fn().mockResolvedValue({ Config: { Labels: {} } }) };
  const docker = {
    createVolume: jest.fn().mockResolvedValue({}),
    createContainer: jest.fn().mockResolvedValue(container),
    getContainer: jest.fn().mockReturnValue(container),
    getVolume: jest.fn().mockReturnValue(volume),
    listContainers: jest.fn().mockResolvedValue([]),
    getImage: jest.fn().mockReturnValue(image),
  };
  const launcher = new DockerTaskLauncher({ ...config, ...overrides }, docker as unknown as Docker);
  return { launcher, docker, container, volume, image };
}

function envOf(call: { Env: string[] }): Record<string, string> {
  return Object.fromEntries(call.Env.map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));
}

describe('DockerTaskLauncher.launch', () => {
  it('creates the volume, then the container, then starts it, and returns the bridge url', async () => {
    const { launcher, docker, container } = setup();
    const order: string[] = [];
    docker.createVolume.mockImplementation(() => { order.push('volume'); return Promise.resolve({}); });
    docker.createContainer.mockImplementation(() => { order.push('create'); return Promise.resolve(container); });
    container.start.mockImplementation(() => { order.push('start'); return Promise.resolve(); });

    const result = await launcher.launch(spec);

    expect(order).toEqual(['volume', 'create', 'start']);
    expect(result).toEqual({ bridgeUrl: 'http://agentic-ui-task-T-20261016-ab12:8765' });
    expect(docker.createVolume).toHaveBeenCalledWith(expect.objectContaining({ Name: 'agentic-ui-task-T-20261016-ab12' }));
  });

  it('sets image, name, command, labels, volume, network and hardening exactly as specified', async () => {
    const { launcher, docker } = setup();
    await launcher.launch(spec);
    const c = docker.createContainer.mock.calls[0][0];

    expect(c.Image).toBe('agentic-dev:test');
    expect(c.name).toBe('agentic-ui-task-T-20261016-ab12');
    expect(c.Cmd).toEqual(['agentic-bridge']);
    expect(c.Labels).toEqual({ 'agentic-ui.task': 'T-20261016-ab12', 'agentic-ui.kind': 'task' });
    expect(c.HostConfig.Binds).toEqual(['agentic-ui-task-T-20261016-ab12:/task']);
    expect(c.HostConfig.NetworkMode).toBe('agentic-net');
    expect(c.HostConfig.CapDrop).toEqual(['ALL']);
    expect(c.HostConfig.SecurityOpt).toEqual(['no-new-privileges']);
    expect(c.HostConfig.RestartPolicy).toBeUndefined();
  });

  it('passes the listed environment, with secrets from the config', async () => {
    const { launcher, docker } = setup();
    await launcher.launch(spec);
    expect(envOf(docker.createContainer.mock.calls[0][0])).toEqual({
      AGENTIC_TASK_TOKEN: TASK_TOKEN,
      AGENTIC_AGENT_TOKEN: AGENT_TOKEN,
      AGENTIC_TASK_ID: 'T-20261016-ab12',
      AGENTIC_PROJECT: 'proj',
      AGENTIC_TASK_DIR: '/task',
      AGENTIC_COST_LEDGER_DIR: '/task',
      AGENTIC_REPO_URL: 'https://github.com/o/r.git',
      AGENTIC_PROMPT: 'do the thing',
      AGENTIC_ALLOWED_ACTIONS: 'push,open-pr',
      AGENTIC_WORKTREE: '1',
      AGENTIC_BRANCH: 'agentic/T-20261016-ab12',
      AGENTIC_BRIDGE_HOSTS: 'agentic-ui-task-T-20261016-ab12',
      CLAUDE_CODE_OAUTH_TOKEN: OAUTH,
      GH_TOKEN: GH,
      GIT_AUTHOR_NAME: 'Made Up Bot',
      GIT_AUTHOR_EMAIL: 'made-up-bot@example.invalid',
      GIT_COMMITTER_NAME: 'Made Up Bot',
      GIT_COMMITTER_EMAIL: 'made-up-bot@example.invalid',
      ...gitCredentialEnv('https://github.com/o/r.git'),
    });
  });

  it('sets the git credential config for the host of the task repository, with the token only by reference', async () => {
    const { launcher, docker } = setup();
    await launcher.launch({ ...spec, repoUrl: 'https://git.example.org/o/r.git' });
    const env = envOf(docker.createContainer.mock.calls[0][0]);
    expect(env.GIT_CONFIG_COUNT).toBe('4');
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.https://git.example.org.helper');
    expect(env.GIT_CONFIG_VALUE_1).toContain('${GH_TOKEN:-$GIT_TOKEN}');
    const gitValues = Object.entries(env).filter(([k]) => k.startsWith('GIT_')).map(([, v]) => v).join('\n');
    for (const secret of [OAUTH, GH, TASK_TOKEN, AGENT_TOKEN]) expect(gitValues).not.toContain(secret);
  });

  it('adds AGENTIC_REPO_REF and AGENTIC_MODEL only when set', async () => {
    const { launcher, docker } = setup();
    await launcher.launch({ ...spec, repoRef: 'develop', model: 'opus' });
    const env = envOf(docker.createContainer.mock.calls[0][0]);
    expect(env.AGENTIC_REPO_REF).toBe('develop');
    expect(env.AGENTIC_MODEL).toBe('opus');
  });

  it('merges ENGINE_TASK_EXTRA_ENV last and appends ENGINE_TASK_EXTRA_BINDS', async () => {
    const { launcher, docker } = setup({
      taskExtraEnv: { AGENTIC_ACP_CMD: '["node","/fake.mjs"]', AGENTIC_PROJECT: 'override' },
      taskExtraBinds: ['/host/fake.mjs:/fake.mjs:ro'],
    });
    await launcher.launch(spec);
    const c = docker.createContainer.mock.calls[0][0];
    const env = envOf(c);
    expect(env.AGENTIC_ACP_CMD).toBe('["node","/fake.mjs"]');
    expect(env.AGENTIC_PROJECT).toBe('override');
    expect(c.HostConfig.Binds).toEqual(['agentic-ui-task-T-20261016-ab12:/task', '/host/fake.mjs:/fake.mjs:ro']);
  });

  it('puts no secret in labels, command or name', async () => {
    const { launcher, docker } = setup();
    await launcher.launch(spec);
    const c = docker.createContainer.mock.calls[0][0];
    const visible = JSON.stringify({ Labels: c.Labels, Cmd: c.Cmd, name: c.name });
    for (const secret of [OAUTH, GH, TASK_TOKEN, AGENT_TOKEN]) expect(visible).not.toContain(secret);
  });

  it('removes container and volume and rethrows when the start fails', async () => {
    const { launcher, docker, container, volume } = setup();
    container.start.mockRejectedValue(new Error('boom'));
    await expect(launcher.launch(spec)).rejects.toThrow('boom');
    expect(docker.getContainer).toHaveBeenCalledWith('agentic-ui-task-T-20261016-ab12');
    expect(container.remove).toHaveBeenCalledWith(expect.objectContaining({ force: true, v: true }));
    expect(volume.remove).toHaveBeenCalled();
  });

  it('removes the volume and rethrows the original error when the container cannot be created, even if cleanup fails', async () => {
    const { launcher, docker, container, volume } = setup();
    docker.createContainer.mockRejectedValue(new Error('no image'));
    container.remove.mockRejectedValue(dockerError(404));
    volume.remove.mockRejectedValue(new Error('cleanup failed'));
    await expect(launcher.launch(spec)).rejects.toThrow('no image');
    expect(volume.remove).toHaveBeenCalled();
  });

  it('does not clean up when the volume cannot be created', async () => {
    const { launcher, docker, volume } = setup();
    docker.createVolume.mockRejectedValue(new Error('no volume'));
    await expect(launcher.launch(spec)).rejects.toThrow('no volume');
    expect(docker.createContainer).not.toHaveBeenCalled();
    expect(volume.remove).not.toHaveBeenCalled();
  });
});

describe('DockerTaskLauncher start, stop, remove, inspect, countRunning', () => {
  const name = 'agentic-ui-task-T-20261016-ab12';

  it('starts the named container and tolerates an already running one (304)', async () => {
    const { launcher, docker, container } = setup();
    await launcher.start(spec.taskId);
    expect(docker.getContainer).toHaveBeenCalledWith(name);
    container.start.mockRejectedValue(dockerError(304));
    await expect(launcher.start(spec.taskId)).resolves.toBeUndefined();
    container.start.mockRejectedValue(dockerError(500));
    await expect(launcher.start(spec.taskId)).rejects.toThrow('docker 500');
  });

  it('stops with a short timeout and tolerates an already stopped container (304)', async () => {
    const { launcher, container } = setup();
    await launcher.stop(spec.taskId);
    expect(container.stop).toHaveBeenCalledWith({ t: 10 });
    container.stop.mockRejectedValue(dockerError(304));
    await expect(launcher.stop(spec.taskId)).resolves.toBeUndefined();
    container.stop.mockRejectedValue(dockerError(500));
    await expect(launcher.stop(spec.taskId)).rejects.toThrow('docker 500');
  });

  it('removes the container with its anonymous volumes, then the task volume', async () => {
    const { launcher, docker, container, volume } = setup();
    await launcher.remove(spec.taskId);
    expect(container.remove).toHaveBeenCalledWith({ force: true, v: true });
    expect(docker.getVolume).toHaveBeenCalledWith(name);
    expect(volume.remove).toHaveBeenCalled();
  });

  it('remove is idempotent when container and volume are missing', async () => {
    const { launcher, container, volume } = setup();
    container.remove.mockRejectedValue(dockerError(404));
    volume.remove.mockRejectedValue(dockerError(404));
    await expect(launcher.remove(spec.taskId)).resolves.toBeUndefined();
  });

  it('remove still fails on other errors', async () => {
    const { launcher, volume } = setup();
    volume.remove.mockRejectedValue(dockerError(500));
    await expect(launcher.remove(spec.taskId)).rejects.toThrow('docker 500');
  });

  it('inspect reports existence, running state and bridge url', async () => {
    const { launcher, container } = setup();
    expect(await launcher.inspect(spec.taskId)).toEqual({ exists: true, running: true, bridgeUrl: `http://${name}:8765` });
    container.inspect.mockResolvedValue({ State: { Running: false } });
    expect((await launcher.inspect(spec.taskId)).running).toBe(false);
  });

  it('inspect reports a missing container instead of throwing', async () => {
    const { launcher, container } = setup();
    container.inspect.mockRejectedValue(dockerError(404));
    expect(await launcher.inspect(spec.taskId)).toEqual({ exists: false, running: false, bridgeUrl: `http://${name}:8765` });
    container.inspect.mockRejectedValue(dockerError(500));
    await expect(launcher.inspect(spec.taskId)).rejects.toThrow('docker 500');
  });

  it('countRunning counts running containers labelled agentic-ui.kind=task', async () => {
    const { launcher, docker } = setup();
    docker.listContainers.mockResolvedValue([{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }]);
    expect(await launcher.countRunning()).toBe(3);
    expect(docker.listContainers).toHaveBeenCalledWith({ filters: { label: ['agentic-ui.kind=task'], status: ['running'] } });
  });
});

// A tar of one file, as `docker cp` / getArchive returns it: 512-byte header, content padded to 512, two zero blocks.
function tarOf(name: string, content: Buffer, declaredSize = content.length, flag = '0'): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write(declaredSize.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header.write(flag, 156, 'ascii');
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding, Buffer.alloc(1024)]);
}

describe('DockerTaskLauncher.readLedger', () => {
  const archive = (buffer: Buffer) => Readable.from([buffer.subarray(0, 700), buffer.subarray(700)]);

  it('reads /task/ledger.jsonl from the container archive, also in several chunks', async () => {
    const { launcher, docker, container } = setup();
    const text = '{"a":1}\n'.repeat(200);
    container.getArchive.mockResolvedValue(archive(tarOf('ledger.jsonl', Buffer.from(text))));

    await expect(launcher.readLedger('T-1')).resolves.toBe(text);
    expect(docker.getContainer).toHaveBeenCalledWith('agentic-ui-task-T-1');
    expect(container.getArchive).toHaveBeenCalledWith({ path: '/task/ledger.jsonl' });
  });

  it('reads an empty file as empty text', async () => {
    const { launcher, container } = setup();
    container.getArchive.mockResolvedValue(archive(tarOf('ledger.jsonl', Buffer.alloc(0))));
    await expect(launcher.readLedger('T-1')).resolves.toBe('');
  });

  it('returns undefined when the file or container is missing (404)', async () => {
    const { launcher, container } = setup();
    container.getArchive.mockRejectedValue(dockerError(404));
    await expect(launcher.readLedger('T-1')).resolves.toBeUndefined();
  });

  it('rethrows other docker errors', async () => {
    const { launcher, container } = setup();
    container.getArchive.mockRejectedValue(dockerError(500));
    await expect(launcher.readLedger('T-1')).rejects.toThrow('docker 500');
  });

  it('skips a PAX header entry and reads the first regular file', async () => {
    const { launcher, container } = setup();
    const text = '{"a":1}\n';
    const pax = tarOf('pax', Buffer.from('30 mtime=1\n'));
    pax.write('x', 156, 'ascii');
    container.getArchive.mockResolvedValue(archive(Buffer.concat([pax.subarray(0, 1024), tarOf('ledger.jsonl', Buffer.from(text))])));
    await expect(launcher.readLedger('T-1')).resolves.toBe(text);
  });

  it('returns undefined and logs when the file is over the cap, without reading it', async () => {
    const { launcher, container } = setup();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const stream = archive(tarOf('ledger.jsonl', Buffer.alloc(10), LEDGER_MAX_BYTES + 1));
    container.getArchive.mockResolvedValue(stream);

    await expect(launcher.readLedger('T-1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('T-1'));
    expect(stream.destroyed).toBe(true);
    warn.mockRestore();
  });
});

describe('DockerTaskLauncher.readFile', () => {
  const archive = (buffer: Buffer) => Readable.from([buffer.subarray(0, 700), buffer.subarray(700)]);

  it('reads the file from the task worktree /work/.worktrees/<id>', async () => {
    const { launcher, docker, container } = setup();
    const text = 'name: x\n'.repeat(100);
    container.getArchive.mockResolvedValue(archive(tarOf('workflow-draft.yaml', Buffer.from(text))));
    await expect(launcher.readFile('T-1', 'workflow-draft.yaml', 65536)).resolves.toBe(text);
    expect(docker.getContainer).toHaveBeenCalledWith('agentic-ui-task-T-1');
    expect(container.getArchive).toHaveBeenCalledWith({ path: '/work/.worktrees/T-1/workflow-draft.yaml' });
  });

  it('returns null on 404 and rethrows other docker errors', async () => {
    const { launcher, container } = setup();
    container.getArchive.mockRejectedValue(dockerError(404));
    await expect(launcher.readFile('T-1', 'a.yaml', 100)).resolves.toBeNull();
    container.getArchive.mockRejectedValue(dockerError(500));
    await expect(launcher.readFile('T-1', 'a.yaml', 100)).rejects.toThrow('docker 500');
  });

  it('throws when the file is over maxBytes, without reading it', async () => {
    const { launcher, container } = setup();
    const stream = archive(tarOf('a.yaml', Buffer.alloc(10), 101));
    container.getArchive.mockResolvedValue(stream);
    const error: unknown = await launcher.readFile('T-1', 'a.yaml', 100).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorktreeFileTooLargeError);
    expect((error as Error).message).toMatch(/over 100 bytes/);
    expect(stream.destroyed).toBe(true);
  });

  it('refuses a directory or symlink as the first entry instead of returning an inner file', async () => {
    const { launcher, container } = setup();
    const dir = tarOf('plans/', Buffer.alloc(0), 0, '5').subarray(0, 512);
    const inner = tarOf('plans/a.yaml', Buffer.from('x'));
    container.getArchive.mockResolvedValue(archive(Buffer.concat([dir, inner])));
    await expect(launcher.readFile('T-1', 'plans', 100)).rejects.toThrow('not a regular file');
    container.getArchive.mockResolvedValue(archive(tarOf('link.yaml', Buffer.alloc(0), 0, '2')));
    await expect(launcher.readFile('T-1', 'link.yaml', 100)).rejects.toThrow('not a regular file');
  });

  it('refuses .. and absolute paths before calling docker', async () => {
    const { launcher, container } = setup();
    await expect(launcher.readFile('T-1', '../etc/passwd', 100)).rejects.toThrow(BadRequestException);
    await expect(launcher.readFile('T-1', '/etc/passwd', 100)).rejects.toThrow(BadRequestException);
    expect(container.getArchive).not.toHaveBeenCalled();
  });
});

describe('DockerTaskLauncher.hasFiles', () => {
  it('asks the container archive for each path in the task worktree /work/.worktrees/<id> (true when it answers, false on 404)', async () => {
    const { launcher, docker, container } = setup();
    const stream = Readable.from([Buffer.alloc(512)]);
    container.getArchive.mockImplementation(async ({ path }: { path: string }) => {
      if (path === '/work/.worktrees/T-1/plans/7.md') return stream;
      throw dockerError(404);
    });
    await expect(launcher.hasFiles('T-1', ['plans/7.md', 'plans/8.md'])).resolves.toEqual({ 'plans/7.md': true, 'plans/8.md': false });
    expect(docker.getContainer).toHaveBeenCalledWith('agentic-ui-task-T-1');
    expect(container.getArchive).toHaveBeenCalledWith({ path: '/work/.worktrees/T-1/plans/7.md' });
    expect(stream.destroyed).toBe(true);
  });

  it('rethrows other docker errors', async () => {
    const { launcher, container } = setup();
    container.getArchive.mockRejectedValue(dockerError(500));
    await expect(launcher.hasFiles('T-1', ['a'])).rejects.toThrow('docker 500');
  });

  it('refuses .. and absolute paths before calling docker', async () => {
    const { launcher, container } = setup();
    await expect(launcher.hasFiles('T-1', ['ok', '../etc/passwd'])).rejects.toThrow(BadRequestException);
    await expect(launcher.hasFiles('T-1', ['/etc/passwd'])).rejects.toThrow(BadRequestException);
    expect(container.getArchive).not.toHaveBeenCalled();
  });
});

describe('DockerTaskLauncher scheduled env', () => {
  it('sets AGENTIC_SCHEDULED and AGENTIC_RUN_TIMEOUT only for a scheduled task', async () => {
    const { launcher, docker } = setup();
    await launcher.launch({ ...spec, scheduled: { runTimeoutSeconds: 900 } });
    const env = envOf(docker.createContainer.mock.calls[0][0]);
    expect(env.AGENTIC_SCHEDULED).toBe('1');
    expect(env.AGENTIC_RUN_TIMEOUT).toBe('900');
    await launcher.launch(spec);
    const plain = envOf(docker.createContainer.mock.calls[1][0]);
    expect(plain.AGENTIC_SCHEDULED).toBeUndefined();
    expect(plain.AGENTIC_RUN_TIMEOUT).toBeUndefined();
  });
});

describe('DockerTaskLauncher.readTaskFile', () => {
  const archive = (buffer: Buffer) => Readable.from([buffer.subarray(0, 700), buffer.subarray(700)]);

  it.each(['result.md', 'state.json'] as const)('reads /task/%s from the container archive', async (name) => {
    const { launcher, docker, container } = setup();
    const text = 'x'.repeat(1000);
    container.getArchive.mockResolvedValue(archive(tarOf(name, Buffer.from(text))));
    await expect(launcher.readTaskFile('T-1', name)).resolves.toBe(text);
    expect(docker.getContainer).toHaveBeenCalledWith('agentic-ui-task-T-1');
    expect(container.getArchive).toHaveBeenCalledWith({ path: `/task/${name}` });
  });

  it('returns null on 404 and rethrows other docker errors', async () => {
    const { launcher, container } = setup();
    container.getArchive.mockRejectedValue(dockerError(404));
    await expect(launcher.readTaskFile('T-1', 'result.md')).resolves.toBeNull();
    container.getArchive.mockRejectedValue(dockerError(500));
    await expect(launcher.readTaskFile('T-1', 'result.md')).rejects.toThrow('docker 500');
  });

  it('throws when the file is over 64 KB, without reading it', async () => {
    const { launcher, container } = setup();
    const stream = archive(tarOf('result.md', Buffer.alloc(10), TASK_FILE_MAX_BYTES + 1));
    container.getArchive.mockResolvedValue(stream);
    await expect(launcher.readTaskFile('T-1', 'result.md')).rejects.toBeInstanceOf(WorktreeFileTooLargeError);
    expect(stream.destroyed).toBe(true);
  });

  it('refuses any other name before calling docker', async () => {
    const { launcher, container } = setup();
    for (const name of ['ledger.jsonl', '../x', 'a/result.md']) {
      await expect(launcher.readTaskFile('T-1', name as 'result.md')).rejects.toThrow(BadRequestException);
    }
    expect(container.getArchive).not.toHaveBeenCalled();
  });
});

const labelOf = (apps: unknown): string => Buffer.from(JSON.stringify(apps)).toString('base64');

describe('DockerTaskLauncher app ports', () => {
  const apps = { web: { ports: [3000, 9229], url: '/', autostart: true }, api: { ports: [8080], url: '/h', autostart: false } };

  it('publishes each app port on 127.0.0.1 with a Docker-picked host port and returns the host ports', async () => {
    const { launcher, docker, container, image } = setup();
    image.inspect.mockResolvedValue({ Config: { Labels: { 'agentic.apps': labelOf(apps) } } });
    container.inspect.mockResolvedValue({
      State: { Running: true },
      NetworkSettings: { Ports: {
        '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '49153' }],
        '9229/tcp': [{ HostIp: '127.0.0.1', HostPort: '49154' }],
        '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '49155' }],
      } },
    });
    const result = await launcher.launch(spec);
    const c = docker.createContainer.mock.calls[0][0];
    const binding = [{ HostIp: '127.0.0.1', HostPort: '' }];
    expect(c.ExposedPorts).toEqual({ '3000/tcp': {}, '9229/tcp': {}, '8080/tcp': {} });
    expect(c.HostConfig.PortBindings).toEqual({ '3000/tcp': binding, '9229/tcp': binding, '8080/tcp': binding });
    expect(docker.getImage).toHaveBeenCalledWith('agentic-dev:test');
    expect(result.appPorts).toEqual({ web: { 3000: 49153, 9229: 49154 }, api: { 8080: 49155 } });
  });

  it('adds no ports and no appPorts for an image without the label', async () => {
    const { launcher, docker, container } = setup();
    const result = await launcher.launch(spec);
    const c = docker.createContainer.mock.calls[0][0];
    expect(c.ExposedPorts).toBeUndefined();
    expect(c.HostConfig.PortBindings).toBeUndefined();
    expect(result.appPorts).toBeUndefined();
    expect(container.inspect).not.toHaveBeenCalled();
  });

  it('adds no ports and no appPorts for an empty label (e30=)', async () => {
    const { launcher, docker, image } = setup();
    image.inspect.mockResolvedValue({ Config: { Labels: { 'agentic.apps': 'e30=' } } });
    const result = await launcher.launch(spec);
    expect(docker.createContainer.mock.calls[0][0].ExposedPorts).toBeUndefined();
    expect(result.appPorts).toBeUndefined();
  });

  it('publishes 20 distinct ports in all (a port shared by two apps counts once)', async () => {
    const { launcher, docker, image } = setup();
    image.inspect.mockResolvedValue({ Config: { Labels: { 'agentic.apps': labelOf({
      web: { ports: Array.from({ length: 10 }, (_v, i) => 3000 + i), url: '/', autostart: false },
      api: { ports: [3000, ...Array.from({ length: 10 }, (_v, i) => 4000 + i)], url: '/', autostart: false },
    }) } } });
    await launcher.launch(spec);
    expect(Object.keys(docker.createContainer.mock.calls[0][0].HostConfig.PortBindings)).toHaveLength(20);
  });

  it.each([
    ['not base64 json', '%%%secret-value%%%'],
    ['json that is not an object', labelOf([1, 2])],
    ['a port that is not an integer', labelOf({ web: { ports: ['x'], url: '/', autostart: true } })],
    ['a null app entry', labelOf({ web: null })],
    ['a duplicate port', labelOf({ web: { ports: [3000, 3000], url: '/', autostart: true } })],
    ['a bad app name', labelOf({ 'Web App': { ports: [3000], url: '/', autostart: true } })],
    ['the name __proto__', Buffer.from('{"__proto__":{"ports":[3000]}}').toString('base64')],
    ['more than 32 apps', labelOf(Object.fromEntries(Array.from({ length: 33 }, (_v, i) => [`app${i}`, { ports: [3000 + i], url: '/', autostart: false }])))],
    ['more than 16 ports in an app', labelOf({ web: { ports: Array.from({ length: 17 }, (_v, i) => 3000 + i), url: '/', autostart: false } })],
    ['more than 20 distinct ports in all (the socket filter publishes at most 20)', labelOf({
      web: { ports: Array.from({ length: 11 }, (_v, i) => 3000 + i), url: '/', autostart: false },
      api: { ports: Array.from({ length: 10 }, (_v, i) => 4000 + i), url: '/', autostart: false },
    })],
    ['a huge label', labelOf({ web: { ports: Array.from({ length: 50000 }, (_v, i) => 1 + i), url: '/', autostart: false } })],
    ['a port out of range', labelOf({ web: { ports: [70000], url: '/', autostart: true } })],
  ])('starts the task with no apps for a malformed label (%s) and logs once without the value', async (_n, label) => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { launcher, docker, image } = setup();
    image.inspect.mockResolvedValue({ Config: { Labels: { 'agentic.apps': label } } });
    const first = await launcher.launch(spec);
    await launcher.launch({ ...spec, taskId: 'T-20261016-cd34' });
    expect(first.appPorts).toBeUndefined();
    expect(docker.createContainer.mock.calls[0][0].ExposedPorts).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(label);
    expect(String(warn.mock.calls[0][0])).not.toContain('secret-value');
    warn.mockRestore();
  });

  it('starts with no apps when the image cannot be inspected', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { launcher, image } = setup();
    image.inspect.mockRejectedValue(dockerError(404));
    const result = await launcher.launch(spec);
    expect(result).toEqual({ bridgeUrl: 'http://agentic-ui-task-T-20261016-ab12:8765' });
    warn.mockRestore();
  });

  it('keeps the launch working when the host ports cannot be read', async () => {
    const { launcher, container, image } = setup();
    image.inspect.mockResolvedValue({ Config: { Labels: { 'agentic.apps': labelOf(apps) } } });
    container.inspect.mockResolvedValue({ State: { Running: true }, NetworkSettings: { Ports: { '3000/tcp': null } } });
    const result = await launcher.launch(spec);
    expect(result.appPorts).toEqual({ web: {}, api: {} });
  });

  it('reads the current host ports back on start, when Docker assigned new ones', async () => {
    const { launcher, docker, container, image } = setup();
    image.inspect.mockResolvedValue({ Config: { Labels: { 'agentic.apps': labelOf({ other: { ports: [1], url: '/', autostart: false } }) } } });
    container.inspect.mockResolvedValue({
      Config: { Labels: { 'agentic.apps': labelOf(apps) } },
      NetworkSettings: { Ports: {
        '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '50001' }],
        '9229/tcp': [{ HostIp: '127.0.0.1', HostPort: '50002' }],
        '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '50003' }],
      } },
    });
    const result = await launcher.start('T-20261016-ab12');
    expect(container.start).toHaveBeenCalled();
    expect(docker.createContainer).not.toHaveBeenCalled();
    expect(result).toEqual({ web: { 3000: 50001, 9229: 50002 }, api: { 8080: 50003 } });
  });

  it('returns no ports on start for a task without apps, and still tolerates 304', async () => {
    const { launcher, container } = setup();
    container.start.mockRejectedValue(dockerError(304));
    container.inspect.mockResolvedValue({ Config: { Labels: {} }, NetworkSettings: { Ports: {} } });
    await expect(launcher.start('T-20261016-ab12')).resolves.toBeUndefined();
  });

  it('returns undefined on start (record keeps its ports) when the container cannot be inspected', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { launcher, container } = setup();
    container.inspect.mockRejectedValue(new Error('boom'));
    await expect(launcher.start('T-20261016-ab12')).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('returns undefined from launch when the host ports cannot be read after start', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { launcher, container, image } = setup();
    image.inspect.mockResolvedValue({ Config: { Labels: { 'agentic.apps': labelOf(apps) } } });
    container.inspect.mockRejectedValue(new Error('boom'));
    const result = await launcher.launch(spec);
    expect(result.appPorts).toBeUndefined();
    warn.mockRestore();
  });
});
