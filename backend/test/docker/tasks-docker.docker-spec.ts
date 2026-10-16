import Docker from 'dockerode';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { BridgeClient, BridgeEvent } from '../../src/repository/tasks/bridge/bridge-client';
import { BRIDGE_CLIENT_FACTORY, BridgeClientFactory } from '../../src/repository/tasks/bridge/bridge-client.factory';
import { TASK_LAUNCHER, TaskLauncher } from '../../src/repository/tasks/launcher/task-launcher';
import { TasksService, TaskView } from '../../src/service/tasks/tasks.service';
import { until } from '../helpers/local-process-launcher';
import { FAKE_GH_TOKEN, FAKE_OAUTH_TOKEN } from '../helpers/test-env';

// Real Docker, real task image, real bridge, fake agent. WRITTEN BUT NOT YET RUN: the container
// this was developed in has no Docker. Run it with `npm run test:docker`; it needs
//   FAKE_AGENT_DIR  directory with agentic-dev-base's bridge/test/fake-agent.mjs (the file itself
//                   directly inside), mounted read-only into the task as /fake
//   ENGINE_IMAGE    the task image built with `agentic build`
//   a reachable Docker daemon (DOCKER_HOST or the default socket)
// It must run on a Linux host: the test process (not a container on the Docker network) reaches
// the bridge at the container's IP address on its bridge network, which Linux hosts route.
// The test creates and removes its own Docker network.

const BRIDGE_PORT = 8765;

function skipReason(): string | undefined {
  const dir = process.env.FAKE_AGENT_DIR;
  if (!dir) return 'FAKE_AGENT_DIR is not set';
  if (!existsSync(join(dir, 'fake-agent.mjs'))) return `FAKE_AGENT_DIR has no fake-agent.mjs: ${dir}`;
  if (!process.env.ENGINE_IMAGE) return 'ENGINE_IMAGE is not set';
  if (process.platform !== 'linux') return 'needs a Linux host (container IPs must be routable)';
  const info = spawnSync('docker', ['info'], { stdio: 'ignore' });
  if (info.error || info.status !== 0) return 'Docker is not reachable (docker info failed)';
  return undefined;
}

const reason = skipReason();
const describeWithDocker = reason === undefined ? describe : describe.skip;
if (reason !== undefined) {
  // Jest hides console output of skipped suites, so write to stderr directly.
  process.stderr.write(`SKIPPED "TasksService against real Docker": ${reason}\n`);
}

const mentions = (e: BridgeEvent, text: string) => e.type === 'message' && JSON.stringify(e.data).includes(text);

// Builds a git repository with one commit that the task can clone offline. Returns the seed
// directory: repo/ (the repository) and gitconfig (marks every directory safe: the files belong to
// the host user, the task runs as another one).
function makeSeed(root: string): string {
  const seed = join(root, 'seed');
  const repo = join(seed, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  };
  git('init', '-q');
  writeFileSync(join(repo, 'README.md'), 'seed repository for the docker test\n');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'initial');
  writeFileSync(join(seed, 'gitconfig'), '[safe]\n\tdirectory = *\n');
  // mkdtemp makes private directories; the task user is someone else.
  spawnSync('chmod', ['-R', 'a+rX', root]);
  chmodSync(root, 0o755);
  return seed;
}

describeWithDocker('TasksService against real Docker', () => {
  const docker = new Docker();
  const networkName = `agentic-ui-test-${Date.now().toString(36)}`;
  const taskIds: string[] = [];
  let root: string;
  let dataDir: string;
  let moduleRef: TestingModule;
  let tasks: TasksService;
  let launcher: TaskLauncher;
  let task: TaskView;

  // Host to container IP on the test network (sync, because a BridgeClientFactory is sync);
  // Host header stays the container name, which the bridge allows via AGENTIC_BRIDGE_HOSTS.
  const bridgeFactory: BridgeClientFactory = (record) => {
    if (!record.bridgeUrl) throw new Error('Task has no bridge URL yet');
    const name = new URL(record.bridgeUrl).hostname;
    const inspect = spawnSync(
      'docker',
      ['inspect', '-f', `{{with index .NetworkSettings.Networks "${networkName}"}}{{.IPAddress}}{{end}}`, name],
      { encoding: 'utf8' },
    );
    const ip = inspect.status === 0 ? inspect.stdout.trim() : '';
    if (!ip) throw new Error(`No IP address for ${name} on ${networkName}`);
    return new BridgeClient({ baseUrl: `http://${ip}:${BRIDGE_PORT}`, taskToken: record.taskToken, hostHeader: `${name}:${BRIDGE_PORT}` });
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'engine-docker-'));
    dataDir = join(root, 'data');
    mkdirSync(dataDir);
    const seed = makeSeed(root);
    await docker.createNetwork({ Name: networkName, Labels: { 'agentic-ui.kind': 'test' } });

    Object.assign(process.env, {
      ENGINE_LAUNCHER: 'docker',
      ENGINE_DOCKER_NETWORK: networkName,
      ENGINE_DATA_DIR: dataDir,
      ENGINE_REPO_URL: '/seed/repo',
      ENGINE_PROJECT: 'docker-test',
      ENGINE_MAX_RUNNING: '2',
      GH_TOKEN: FAKE_GH_TOKEN,
      CLAUDE_CODE_OAUTH_TOKEN: FAKE_OAUTH_TOKEN,
      // Test hooks: the fake agent and the seed repository (cloned from /seed/repo by the
      // 05-workspace start step, so no network or GitHub is needed).
      ENGINE_TASK_EXTRA_ENV: JSON.stringify({
        AGENTIC_ACP_CMD: JSON.stringify(['node', '/fake/fake-agent.mjs']),
        FAKE_AGENT_STATE: '/tmp/fake-state',
        AGENTIC_REPO_URL: '/seed/repo',
        GIT_CONFIG_GLOBAL: '/seed/gitconfig',
      }),
      ENGINE_TASK_EXTRA_BINDS: JSON.stringify([`${process.env.FAKE_AGENT_DIR}:/fake:ro`, `${seed}:/seed:ro`]),
    });

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BRIDGE_CLIENT_FACTORY)
      .useValue(bridgeFactory)
      .compile();
    await moduleRef.init();
    tasks = moduleRef.get(TasksService);
    launcher = moduleRef.get<TaskLauncher>(TASK_LAUNCHER);
  });

  afterAll(async () => {
    for (const id of taskIds) await launcher?.remove(id).catch(() => undefined);
    await moduleRef?.close();
    await docker?.getNetwork(networkName).remove().catch(() => undefined);
    if (root) rmSync(root, { recursive: true, force: true });
  });

  async function inState(state: string): Promise<TaskView> {
    return until(
      `state ${state}`,
      async () => {
        const view = await tasks.get(task.id);
        return view.state === state ? view : undefined;
      },
      120_000,
    );
  }

  const gone = async (get: () => Promise<unknown>) =>
    get().then(
      () => false,
      (error: { statusCode?: number }) => error.statusCode === 404,
    );

  it('starts a task that clones the seed repository, reaches idle and echoes the first prompt', async () => {
    task = await tasks.start({ prompt: 'start working' });
    taskIds.push(task.id);
    const view = await inState('idle');
    expect(view.branch).toBe(`agentic/${task.id}`);
    const inspection = await launcher.inspect(task.id);
    expect(inspection).toMatchObject({ exists: true, running: true });
    await until('first echo', async () => (await tasks.events(task.id, 0)).some((e) => mentions(e, 'echo: start working')), 60_000);
  });

  it('prompts and sees the echo event', async () => {
    await tasks.prompt(task.id, 'hello docker');
    await until('echo', async () => (await tasks.events(task.id, 0)).some((e) => mentions(e, 'echo: hello docker')), 60_000);
    await inState('idle');
  });

  it('stops, removes, and leaves neither container nor volume', async () => {
    const stopped = await tasks.stop(task.id);
    expect(stopped.state).toBe('stopped');
    expect((await launcher.inspect(task.id)).running).toBe(false);
    await tasks.remove(task.id);
    const name = `agentic-ui-task-${task.id}`;
    expect(await gone(() => docker.getContainer(name).inspect())).toBe(true);
    expect(await gone(() => docker.getVolume(name).inspect())).toBe(true);
    expect(await tasks.list()).toEqual([]);
  });
});
