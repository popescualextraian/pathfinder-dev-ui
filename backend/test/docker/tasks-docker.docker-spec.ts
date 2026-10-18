import Docker from 'dockerode';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { BridgeClient, BridgeClientFactory, BridgeEvent, BRIDGE_CLIENT_FACTORY } from '../../src/engine/service/bridge-client';
import { TASK_LAUNCHER, TaskLauncher } from '../../src/engine/service/task-launcher';
import { TasksService, TaskView } from '../../src/engine/service/tasks.service';
import { until } from '../helpers/local-process-launcher';
import { FAKE_GH_TOKEN, FAKE_OAUTH_TOKEN } from '../helpers/test-env';
import { HelperContainer, InNetworkBridgeClient } from './in-network-bridge';

// Real Docker, real task image, real bridge, fake agent: TasksService and DockerTaskLauncher run in
// this process and drive the Docker API. Run with `npm run test:docker`; it needs
//   ENGINE_IMAGE    the task image built with `agentic build`
//   FAKE_AGENT_DIR  directory with agentic-dev-base's bridge/test/fake-agent.mjs (the file itself
//                   directly inside), mounted read-only into the task as /fake
//   a reachable Docker daemon (DOCKER_HOST or the default socket): Linux Docker or Docker Desktop
// Without them the suite is skipped with a message on stderr.
// The test process never connects to a container IP (Docker Desktop cannot route to them): bridge
// requests run in a helper container from ENGINE_IMAGE on the test network and reach the task by
// its container name, as the UI does in production (see in-network-bridge.ts). The suite creates
// its own network, helper container and temp directories and removes them, and every task
// container and volume, in afterAll, also after a failure.

function skipReason(): string | undefined {
  const dir = process.env.FAKE_AGENT_DIR;
  if (!dir) return 'FAKE_AGENT_DIR is not set';
  if (!existsSync(join(dir, 'fake-agent.mjs'))) return `FAKE_AGENT_DIR has no fake-agent.mjs: ${dir}`;
  if (!process.env.ENGINE_IMAGE) return 'ENGINE_IMAGE is not set';
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
  const suffix = `${Date.now().toString(36)}-${process.pid}`;
  const networkName = `agentic-ui-test-${suffix}`;
  const helperName = `agentic-ui-test-helper-${suffix}`;
  const taskIds = new Set<string>();
  let networkCreated = false;
  let root: string | undefined;
  let dataDir: string;
  let helper: HelperContainer | undefined;
  let moduleRef: TestingModule | undefined;
  let tasks: TasksService;
  let launcher: TaskLauncher | undefined;
  let task: TaskView;

  // Bridge requests go through the helper container (by container name, inside the network).
  // A name that does not resolve yet (container not attached yet) is "unreachable", which the
  // service's wait for the bridge retries.
  const bridgeFactory: BridgeClientFactory = (record) => {
    if (!record.bridgeUrl) throw new Error('Task has no bridge URL yet');
    if (!helper) throw new Error('Bridge helper container is not running');
    const running = helper;
    return new InNetworkBridgeClient(record.bridgeUrl, record.taskToken, (request) => running.exec(request)) as unknown as BridgeClient;
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'engine-docker-'));
    dataDir = join(root, 'data');
    mkdirSync(dataDir);
    const seed = makeSeed(root);
    await docker.createNetwork({ Name: networkName, Labels: { 'agentic-ui.kind': 'test' } });
    networkCreated = true;
    helper = await HelperContainer.create(docker, { image: process.env.ENGINE_IMAGE!, network: networkName, name: helperName });
    await helper.waitUntilReady();

    Object.assign(process.env, {
      ENGINE_LAUNCHER: 'docker',
      ENGINE_DOCKER_NETWORK: networkName,
      ENGINE_DATA_DIR: dataDir,
      ENGINE_REPO_URL: '/seed/repo',
      ENGINE_PROJECT: 'docker-test',
      ENGINE_MAX_RUNNING: '2',
      ENGINE_GIT_NAME: 'Docker Test Bot',
      ENGINE_GIT_EMAIL: 'docker-test-bot@example.invalid',
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

  // Every step on its own: a failed test or a beforeAll that threw part-way must not leave
  // containers, volumes, the network or temp directories behind.
  afterAll(async () => {
    const step = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        process.stderr.write(`docker suite cleanup: ${what} failed: ${String(error)}\n`);
      }
    };
    const removeTask = async (name: string) => {
      await docker.getContainer(name).remove({ force: true, v: true }).catch((e: { statusCode?: number }) => {
        if (e.statusCode !== 404) throw e;
      });
      await docker.getVolume(name).remove().catch((e: { statusCode?: number }) => {
        if (e.statusCode !== 404) throw e;
      });
    };
    // Tasks: the ids the tests saw, the records on disk (a start that failed late), and any task
    // container on the test network.
    if (dataDir && existsSync(dataDir)) {
      for (const file of readdirSync(dataDir)) if (file.endsWith('.json')) taskIds.add(file.slice(0, -'.json'.length));
    }
    const names = new Set([...taskIds].map((id) => `agentic-ui-task-${id}`));
    await step('listing task containers', async () => {
      const listed = await docker.listContainers({ all: true, filters: { network: [networkName], label: ['agentic-ui.kind=task'] } });
      for (const c of listed) for (const n of c.Names) names.add(n.replace(/^\//, ''));
    });
    for (const name of names) await step(`removing ${name}`, () => removeTask(name));
    await step('closing the app', async () => moduleRef?.close());
    await step('removing the helper container', () =>
      docker.getContainer(helperName).remove({ force: true }).catch((e: { statusCode?: number }) => {
        if (e.statusCode !== 404) throw e;
      }),
    );
    if (networkCreated) await step('removing the network', () => docker.getNetwork(networkName).remove());
    if (root) {
      const dir = root;
      await step('removing temp directories', async () => rmSync(dir, { recursive: true, force: true }));
    }
  });

  async function inState(state: string, timeoutMs = 120_000): Promise<TaskView> {
    return until(
      `state ${state}`,
      async () => {
        const view = await tasks.get(task.id);
        return view.state === state ? view : undefined;
      },
      timeoutMs,
    );
  }

  const echoed = (text: string) =>
    until(`echo of "${text}"`, async () => (await tasks.events(task.id, 0)).some((e) => mentions(e, `echo: ${text}`)), 60_000);

  const gone = async (get: () => Promise<unknown>) =>
    get().then(
      () => false,
      (error: { statusCode?: number }) => error.statusCode === 404,
    );

  it('starts a task that clones the seed repository, reaches idle and echoes the first prompt', async () => {
    // start() waits up to 60 s for the bridge; clone plus bridge boot may take longer on a slow
    // host. Then it answers 502 but keeps the task, which we keep waiting for.
    task = await tasks.start({ prompt: 'start working' }).catch(async (error: { getStatus?: () => number }) => {
      if (error.getStatus?.() !== 502) throw error;
      const [created] = await tasks.list();
      if (!created) throw error;
      return created;
    });
    taskIds.add(task.id);
    const view = await inState('idle');
    expect(view.branch).toBe(`agentic/${task.id}`);
    expect(await launcher!.inspect(task.id)).toMatchObject({ exists: true, running: true });
    await echoed('start working');
  });

  it('gives the task container the commit identity', async () => {
    const info = await docker.getContainer(`agentic-ui-task-${task.id}`).inspect();
    const env = info.Config.Env ?? [];
    for (const name of ['GIT_AUTHOR', 'GIT_COMMITTER']) {
      expect(env).toContain(`${name}_NAME=Docker Test Bot`);
      expect(env).toContain(`${name}_EMAIL=docker-test-bot@example.invalid`);
    }
  });

  it('prompts and sees the echo event', async () => {
    await tasks.prompt(task.id, 'hello docker');
    await echoed('hello docker');
    await inState('idle');
  });

  it('reads the task ledger from /task: nothing without one, the text with one', async () => {
    expect(await launcher!.readLedger(task.id)).toBeUndefined();
    const line = (session: string, input: number) => JSON.stringify({
      schema: 'cost-record/v1', ts: '2026-10-18T10:00:00Z', project: 'docker-test', harness: 'claude', session,
      context: { kind: 'task', task: task.id }, models: [],
      totals: { input, output: 2, cache_read: 3, cache_write: 4, cost: { estimate: 0.5 } },
    });
    const ledger = `${line('s1', 10)}\n${line('s2', 20)}\n`;
    const exec = await docker.getContainer(`agentic-ui-task-${task.id}`).exec({
      Cmd: ['sh', '-c', `printf %s ${Buffer.from(ledger).toString('base64')} | base64 -d > /task/ledger.jsonl`],
      AttachStdout: true, AttachStderr: true,
    });
    const stream = await exec.start({ Detach: false, Tty: false });
    await new Promise((done) => { stream.on('end', done); stream.on('close', done); stream.resume(); });
    expect((await exec.inspect()).ExitCode).toBe(0);
    expect(await launcher!.readLedger(task.id)).toBe(ledger);
  });

  it('wakes a container stopped with docker stop when prompted', async () => {
    await docker.getContainer(`agentic-ui-task-${task.id}`).stop({ t: 10 });
    expect((await tasks.get(task.id)).state).toBe('suspended');
    await tasks.prompt(task.id, 'after docker stop');
    expect((await launcher!.inspect(task.id)).running).toBe(true);
    await echoed('after docker stop');
    await inState('idle');
  });

  it('stops; a stopped task refuses prompts at once without starting; removes and leaves nothing', async () => {
    const stopped = await tasks.stop(task.id);
    expect(stopped.state).toBe('stopped');
    expect((await launcher!.inspect(task.id)).running).toBe(false);

    const startedAt = Date.now();
    await expect(tasks.prompt(task.id, 'too late')).rejects.toThrow(/task is stopped/);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect((await launcher!.inspect(task.id)).running).toBe(false);

    await tasks.remove(task.id);
    const name = `agentic-ui-task-${task.id}`;
    expect(await gone(() => docker.getContainer(name).inspect())).toBe(true);
    expect(await gone(() => docker.getVolume(name).inspect())).toBe(true);
    expect(await tasks.list()).toEqual([]);
  });
});
