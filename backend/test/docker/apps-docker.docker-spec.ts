import Docker from 'dockerode';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { BridgeClient, BridgeClientFactory, BRIDGE_CLIENT_FACTORY } from '../../src/engine/service/bridge-client';
import { TasksService, TaskView } from '../../src/engine/service/tasks.service';
import { until } from '../helpers/local-process-launcher';
import { FAKE_GH_TOKEN, FAKE_OAUTH_TOKEN } from '../helpers/test-env';
import { HelperContainer, InNetworkBridgeClient } from './in-network-bridge';

// Apps in a task, real Docker: a task image with a fixture app `web` (say `python3 -m http.server 8080`,
// ports [8080], built with `apps:` in agentic.yaml so the image carries the label agentic.apps) is
// started, the app is started through TasksService (the code behind POST /api/tasks/:id/apps/web/start),
// the published localhost port answers 200, and stop stops it. Needs, as tasks-docker.docker-spec.ts,
//   ENGINE_IMAGE    the task image; it must carry the label agentic.apps with an app named `web`
//   FAKE_AGENT_DIR  directory with agentic-dev-base's bridge/test/fake-agent.mjs, mounted at /fake
//   a reachable Docker daemon
// Otherwise the suite is skipped with a message on stderr. It creates its own network, helper
// container, temp directories, task container and volume and removes them on every path.

function skipReason(): string | undefined {
  const dir = process.env.FAKE_AGENT_DIR;
  if (!dir) return 'FAKE_AGENT_DIR is not set';
  if (!existsSync(join(dir, 'fake-agent.mjs'))) return `FAKE_AGENT_DIR has no fake-agent.mjs: ${dir}`;
  const image = process.env.ENGINE_IMAGE;
  if (!image) return 'ENGINE_IMAGE is not set';
  const info = spawnSync('docker', ['info'], { stdio: 'ignore' });
  if (info.error || info.status !== 0) return 'Docker is not reachable (docker info failed)';
  const label = spawnSync('docker', ['image', 'inspect', '--format', '{{index .Config.Labels "agentic.apps"}}', image], { encoding: 'utf8' });
  if (label.status !== 0 || !label.stdout.trim()) return `ENGINE_IMAGE has no agentic.apps label (no fixture app): ${image}`;
  return undefined;
}

const reason = skipReason();
const describeWithDocker = reason === undefined ? describe : describe.skip;
if (reason !== undefined) {
  // Jest hides console output of skipped suites, so write to stderr directly.
  process.stderr.write(`SKIPPED "apps against real Docker": ${reason}\n`);
}

// One commit the task can clone offline; same as the tasks suite.
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
  spawnSync('chmod', ['-R', 'a+rX', root]);
  chmodSync(root, 0o755);
  return seed;
}

function httpStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.setTimeout(5_000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

describeWithDocker('apps against real Docker', () => {
  const docker = new Docker();
  const suffix = `${Date.now().toString(36)}-${process.pid}`;
  const networkName = `agentic-ui-test-apps-${suffix}`;
  const helperName = `agentic-ui-test-apps-helper-${suffix}`;
  const taskIds = new Set<string>();
  let networkCreated = false;
  let root: string | undefined;
  let dataDir: string;
  let helper: HelperContainer | undefined;
  let moduleRef: TestingModule | undefined;
  let tasks: TasksService;
  let task: TaskView;

  const bridgeFactory: BridgeClientFactory = (record) => {
    if (!record.bridgeUrl) throw new Error('Task has no bridge URL yet');
    if (!helper) throw new Error('Bridge helper container is not running');
    const running = helper;
    return new InNetworkBridgeClient(record.bridgeUrl, record.taskToken, (request) => running.exec(request)) as unknown as BridgeClient;
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'engine-docker-apps-'));
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
      ENGINE_PROJECT: 'docker-apps-test',
      ENGINE_MAX_RUNNING: '2',
      ENGINE_GIT_NAME: 'Docker Test Bot',
      ENGINE_GIT_EMAIL: 'docker-test-bot@example.invalid',
      GH_TOKEN: FAKE_GH_TOKEN,
      CLAUDE_CODE_OAUTH_TOKEN: FAKE_OAUTH_TOKEN,
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
  });

  // Every step on its own: nothing may stay behind after a failure, also one part-way through beforeAll.
  afterAll(async () => {
    const step = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (error) {
        process.stderr.write(`docker apps suite cleanup: ${what} failed: ${String(error)}\n`);
      }
    };
    const ignore404 = (e: { statusCode?: number }) => {
      if (e.statusCode !== 404) throw e;
    };
    const removeTask = async (name: string) => {
      await docker.getContainer(name).remove({ force: true, v: true }).catch(ignore404);
      await docker.getVolume(name).remove().catch(ignore404);
    };
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
    await step('removing the helper container', () => docker.getContainer(helperName).remove({ force: true }).catch(ignore404));
    if (networkCreated) await step('removing the network', () => docker.getNetwork(networkName).remove());
    if (root) {
      const dir = root;
      await step('removing temp directories', async () => rmSync(dir, { recursive: true, force: true }));
    }
  });

  it('starts the app web; its published localhost link answers 200; stop stops it', async () => {
    // start() waits for the bridge; when that takes longer it answers 502 but keeps the task.
    task = await tasks.start({ prompt: 'start working' }).catch(async (error: { getStatus?: () => number }) => {
      if (error.getStatus?.() !== 502) throw error;
      const [created] = await tasks.list();
      if (!created) throw error;
      return created;
    });
    taskIds.add(task.id);
    await until('task idle', async () => (await tasks.get(task.id)).state === 'idle', 120_000);

    const started = await tasks.appAction(task.id, 'web', 'start');
    expect(started.name).toBe('web');
    expect(started.link).toMatch(/^http:\/\/localhost:\d+\//);

    // The server inside may need a moment after the bridge reports the app started.
    const status = await until('the app answering', async () => httpStatus(started.link!).catch(() => undefined), 60_000);
    expect(status).toBe(200);

    const stopped = await tasks.appAction(task.id, 'web', 'stop');
    expect(stopped.state).not.toBe('running');
    await until('the app listed as not running', async () => (await tasks.apps(task.id)).every((a) => a.state !== 'running'), 30_000);
  });
});
