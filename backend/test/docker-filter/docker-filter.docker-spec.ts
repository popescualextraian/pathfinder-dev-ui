import Docker from 'dockerode';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineConfig } from '../../src/commons/engine-config';
import { DockerTaskLauncher } from '../../src/engine/integration/launcher/docker-task-launcher';
import { LaunchSpec } from '../../src/engine/service/task-launcher';
import { FilterConfig } from '../../../socket-filter/src/config';
import { FilterServer, startFilterServer } from '../../../socket-filter/src/server';

// The socket filter in front of a REAL Docker daemon. Run with `npm run test:docker:filter`; it needs
//   ENGINE_IMAGE   the task image built with `agentic build` (any local image works for the refusals)
//   a Docker daemon reachable on a Unix socket (DOCKER_HOST=unix://... or /var/run/docker.sock)
// Without them the suite is skipped with a message on stderr.
// What it does: starts the filter (this process) on a temp socket with the daemon as upstream, drives
// DockerTaskLauncher through it (made-up tokens, a repository that cannot be cloned, so the task container
// ends quickly and never talks to anything), then sends forbidden requests with dockerode through the filter
// and checks over the RAW daemon socket that each one created or changed nothing. Everything it creates
// (network, task containers, volumes, an unlabelled container) has a per-run unique name and is removed in
// afterAll, also after a failure.

function upstreamSocket(): string {
  const host = process.env.DOCKER_HOST;
  if (host === undefined || host === '') return '/var/run/docker.sock';
  return host.startsWith('unix://') ? host.slice('unix://'.length) : '';
}

function skipReason(): string | undefined {
  if (!process.env.ENGINE_IMAGE) return 'ENGINE_IMAGE is not set';
  const socket = upstreamSocket();
  if (!socket) return 'DOCKER_HOST is not a unix:// socket';
  if (!existsSync(socket)) return `the Docker socket ${socket} does not exist`;
  const info = spawnSync('docker', ['info'], { stdio: 'ignore' });
  if (info.error || info.status !== 0) return 'Docker is not reachable (docker info failed)';
  const image = spawnSync('docker', ['image', 'inspect', process.env.ENGINE_IMAGE], { stdio: 'ignore' });
  if (image.status !== 0) return 'ENGINE_IMAGE is not a local image (run agentic build)';
  return undefined;
}

const reason = skipReason();
const describeWithDocker = reason === undefined ? describe : describe.skip;
if (reason !== undefined) {
  // Jest hides console output of skipped suites, so write to stderr directly.
  process.stderr.write(`SKIPPED "socket filter against real Docker": ${reason}\n`);
}

interface RawResponse {
  status: number;
  body: string;
}

// A request straight to the daemon, bypassing the filter.
function raw(socketPath: string, method: string, path: string, body?: unknown): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(
      { socketPath, method, path, headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const rejection = async (promise: Promise<unknown>): Promise<number | undefined> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode;
  }
};

describeWithDocker('socket filter against real Docker', () => {
  const image = process.env.ENGINE_IMAGE as string;
  const upstream = upstreamSocket();
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const networkName = `agentic-ui-filtertest-${unique}`;
  const idOf = (what: string) => `T-ft${unique}-${what}`;
  const nameOf = (id: string) => `agentic-ui-task-${id}`;
  const labelsOf = (id: string) => ({ 'agentic-ui.task': id, 'agentic-ui.kind': 'task' });
  const launchedIds = new Set<string>();
  const rawContainers = new Set<string>();
  const rawVolumes = new Set<string>();
  const logs: string[] = [];

  let dir: string | undefined;
  let networkId: string | undefined;
  let filter: FilterServer | undefined;
  let viaFilter: Docker;
  let launcher: DockerTaskLauncher;

  const engineConfig = (): Pick<
    EngineConfig,
    'image' | 'dockerNetwork' | 'project' | 'claudeCodeOauthToken' | 'ghToken' | 'gitName' | 'gitEmail' | 'taskExtraEnv' | 'taskExtraBinds'
  > => ({
    image,
    dockerNetwork: networkName,
    project: 'docker-filter-test',
    claudeCodeOauthToken: 'made-up-oauth-token-0000',
    ghToken: 'made-up-gh-token-0000',
    gitName: 'Filter Test Bot',
    gitEmail: 'filter-test-bot@example.invalid',
    taskExtraEnv: {},
    taskExtraBinds: [],
  });

  const spec = (id: string): LaunchSpec => ({
    taskId: id,
    taskToken: 'made-up-task-token-0000',
    agentToken: 'made-up-agent-token-0000',
    prompt: '',
    // Not cloneable: the start step fails and the container ends by itself; nothing is contacted.
    repoUrl: '/nonexistent/filter-test-repo',
    branch: `agentic/${id}`,
  });

  const containerExists = async (name: string) => (await raw(upstream, 'GET', `/containers/${name}/json`)).status === 200;
  const volumeExists = async (name: string) => (await raw(upstream, 'GET', `/volumes/${name}`)).status === 200;
  const nothingCreated = async (id: string) => {
    expect(await containerExists(nameOf(id))).toBe(false);
    expect(await volumeExists(nameOf(id))).toBe(false);
  };

  // A container the filter must not touch: right name shape, but no kind label. Made over the raw socket.
  async function createUnlabelled(id: string): Promise<string> {
    const name = nameOf(id);
    rawContainers.add(name);
    const res = await raw(upstream, 'POST', `/containers/create?name=${name}`, {
      Image: image,
      Cmd: ['agentic-bridge'],
      Labels: { 'agentic-ui-filtertest': unique },
    });
    expect(res.status).toBe(201);
    return name;
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'docker-filter-'));
    const created = await raw(upstream, 'POST', '/networks/create', { Name: networkName, Labels: { 'agentic-ui-filtertest': unique } });
    if (created.status !== 201) throw new Error(`Could not create the test network: ${created.status}`);
    networkId = (JSON.parse(created.body) as { Id: string }).Id;
    const config: FilterConfig = {
      image,
      network: networkName,
      listen: join(dir, 'filter.sock'),
      upstream,
      namePrefix: 'agentic-ui-task-',
      labelPrefix: 'agentic-ui.',
      kindLabel: { key: 'agentic-ui.kind', value: 'task' },
      debug: false,
    };
    filter = await startFilterServer(config, (line) => logs.push(line));
    viaFilter = new Docker({ socketPath: config.listen });
    launcher = new DockerTaskLauncher(engineConfig(), viaFilter);
  });

  // Every step on its own: a failed test or a beforeAll that threw part-way must leave nothing behind.
  afterAll(async () => {
    const step = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        process.stderr.write(`docker-filter test cleanup: ${what} failed: ${(error as Error).message}\n`);
      }
    };
    for (const id of launchedIds) {
      await step(`remove task ${id}`, () => raw(upstream, 'DELETE', `/containers/${nameOf(id)}?force=true&v=true`));
      await step(`remove volume of ${id}`, () => raw(upstream, 'DELETE', `/volumes/${nameOf(id)}?force=true`));
    }
    for (const name of rawContainers) await step(`remove container ${name}`, () => raw(upstream, 'DELETE', `/containers/${name}?force=true&v=true`));
    for (const name of rawVolumes) await step(`remove volume ${name}`, () => raw(upstream, 'DELETE', `/volumes/${name}?force=true`));
    if (filter) await step('stop the filter', () => filter!.close());
    if (networkId) await step('remove the network', () => raw(upstream, 'DELETE', `/networks/${networkId}`));
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  describe('DockerTaskLauncher through the filter', () => {
    const id = idOf('launch');

    it('launches, inspects, counts, reads the ledger, checks files, stops, starts and removes without a refusal', async () => {
      launchedIds.add(id);
      await expect(launcher.launch(spec(id))).resolves.toEqual({ bridgeUrl: `http://${nameOf(id)}:8765` });
      expect(await containerExists(nameOf(id))).toBe(true);
      expect(await volumeExists(nameOf(id))).toBe(true);

      await expect(launcher.inspect(id)).resolves.toMatchObject({ exists: true });
      // The task may already have ended (it cannot clone), so the number itself is not fixed here: it must be
      // a count of running containers; the exact count and the unlabelled-container case are in the next test.
      expect(Number.isInteger(await launcher.countRunning())).toBe(true);
      await expect(launcher.readLedger(id)).resolves.toBeUndefined();
      await expect(launcher.hasFiles(id, ['no-such-file.txt'])).resolves.toEqual({ 'no-such-file.txt': false });

      await launcher.stop(id);
      await launcher.start(id);
      await launcher.stop(id);
      await launcher.remove(id);
      await expect(launcher.inspect(id)).resolves.toMatchObject({ exists: false });
      await nothingCreated(id);
      expect(logs).toEqual([]);
    });

    it('counts only running containers with the kind label, not a running unlabelled one', async () => {
      const name = nameOf(idOf('unlabelled-running'));
      rawContainers.add(name);
      const made = await raw(upstream, 'POST', `/containers/create?name=${name}`, {
        Image: image,
        Entrypoint: ['sh', '-c', 'sleep 60'],
        Labels: { 'agentic-ui-filtertest': unique },
      });
      expect(made.status).toBe(201);
      expect((await raw(upstream, 'POST', `/containers/${name}/start`)).status).toBe(204);
      const running = async (filters: object) =>
        (JSON.parse((await raw(upstream, 'GET', `/containers/json?filters=${encodeURIComponent(JSON.stringify(filters))}`)).body) as unknown[]).length;
      const labelled = await running({ label: ['agentic-ui.kind=task'], status: ['running'] });
      const all = await running({ status: ['running'] });
      expect(all).toBeGreaterThan(labelled);
      expect(await launcher.countRunning()).toBe(labelled);
      await raw(upstream, 'DELETE', `/containers/${name}?force=true&v=true`);
    });

    it('refuses ENGINE_TASK_EXTRA_BINDS and leaves nothing behind', async () => {
      const bindId = idOf('binds');
      launchedIds.add(bindId);
      const withBinds = new DockerTaskLauncher({ ...engineConfig(), taskExtraBinds: ['/tmp:/extra:ro'] }, viaFilter);
      expect(await rejection(withBinds.launch(spec(bindId)))).toBe(403);
      await nothingCreated(bindId);
    });
  });

  describe('forbidden requests with dockerode through the filter', () => {
    // The launcher's own valid create body (Binds [<name>:/task], network, CapDrop, SecurityOpt, labels). Each
    // forbidden test changes exactly one field of it, so a 403 can only come from the rule under test.
    const create = (id: string, over: Record<string, unknown> = {}, host: Record<string, unknown> = {}) =>
      viaFilter.createContainer({
        Image: image,
        name: nameOf(id),
        Cmd: ['agentic-bridge'],
        Labels: labelsOf(id),
        HostConfig: { Binds: [`${nameOf(id)}:/task`], NetworkMode: networkName, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], ...host },
        ...over,
      } as Docker.ContainerCreateOptions);

    it('control: the unmodified body is accepted (201) and removed again', async () => {
      const id = idOf('control');
      launchedIds.add(id);
      const container = await create(id);
      expect(container.id).toMatch(/^[0-9a-f]{64}$/);
      expect(await containerExists(nameOf(id))).toBe(true);
      // Not container.remove(): that object is bound to the 64-hex id, and the filter refuses remove by id; the launcher removes by name.
      await viaFilter.getContainer(nameOf(id)).remove({ force: true, v: true });
      expect(await containerExists(nameOf(id))).toBe(false);
    });

    it('refuses a privileged container', async () => {
      const id = idOf('priv');
      launchedIds.add(id);
      expect(await rejection(create(id, {}, { Privileged: true }))).toBe(403);
      await nothingCreated(id);
    });

    it('refuses a bind of the host root', async () => {
      const id = idOf('bind');
      launchedIds.add(id);
      expect(await rejection(create(id, {}, { Binds: [`${nameOf(id)}:/task`, '/:/host'] }))).toBe(403);
      await nothingCreated(id);
    });

    it('refuses another image', async () => {
      const id = idOf('image');
      launchedIds.add(id);
      expect(await rejection(create(id, { Image: 'agentic-ui-filtertest-not-the-image:none' }))).toBe(403);
      await nothingCreated(id);
    });

    it('refuses another network', async () => {
      const id = idOf('network');
      launchedIds.add(id);
      expect(await rejection(create(id, {}, { NetworkMode: 'host' }))).toBe(403);
      await nothingCreated(id);
    });

    it('refuses exec into a task container', async () => {
      const id = idOf('exec');
      launchedIds.add(id);
      await launcher.launch(spec(id));
      const container = viaFilter.getContainer(nameOf(id));
      expect(await rejection(container.exec({ Cmd: ['id'], AttachStdout: true }))).toBe(403);
      // Nothing was started in it: the daemon knows no exec instances for the container.
      const info = JSON.parse((await raw(upstream, 'GET', `/containers/${nameOf(id)}/json`)).body) as { ExecIDs: string[] | null };
      expect(info.ExecIDs ?? []).toEqual([]);
      await launcher.remove(id);
    });

    it('refuses to start, stop, inspect and remove a container without the kind label, which stays as it was', async () => {
      const id = idOf('foreign');
      const name = await createUnlabelled(id);
      const container = viaFilter.getContainer(name);
      expect(await rejection(container.start())).toBe(403);
      expect(await rejection(container.stop())).toBe(403);
      expect(await rejection(container.inspect())).toBe(403);
      expect(await rejection(container.remove({ force: true }))).toBe(403);
      const info = JSON.parse((await raw(upstream, 'GET', `/containers/${name}/json`)).body) as { State: { Status: string } };
      expect(info.State.Status).toBe('created');
    });

    it('refuses to remove a volume without the kind label, which stays', async () => {
      const name = nameOf(idOf('foreignvol'));
      rawVolumes.add(name);
      expect((await raw(upstream, 'POST', '/volumes/create', { Name: name })).status).toBe(201);
      expect(await rejection(viaFilter.getVolume(name).remove())).toBe(403);
      expect(await volumeExists(name)).toBe(true);
    });

    it('refuses a local volume that is really a bind mount', async () => {
      const id = idOf('volbind');
      launchedIds.add(id);
      const refused = viaFilter.createVolume({
        Name: nameOf(id),
        Driver: 'local',
        Labels: labelsOf(id),
        DriverOpts: { type: 'none', o: 'bind', device: '/' },
      });
      expect(await rejection(refused)).toBe(403);
      expect(await volumeExists(nameOf(id))).toBe(false);
    });

    it('logged each refusal without any Env value', () => {
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join('\n')).not.toContain('made-up-');
    });
  });
});
