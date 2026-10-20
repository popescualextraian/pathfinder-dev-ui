// DockerTaskLauncher with a real dockerode client talking to the socket filter, which forwards to a fake
// Docker daemon: every request the launcher really sends must pass the filter's allowlist.
import Docker from 'dockerode';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineConfig } from '../../../../../src/commons/engine-config';
import { DockerTaskLauncher } from '../../../../../src/engine/integration/launcher/docker-task-launcher';
import { LaunchSpec } from '../../../../../src/engine/service/task-launcher';
import { FilterConfig } from '../../../../../../socket-filter/src/config';
import { FilterServer, startFilterServer } from '../../../../../../socket-filter/src/server';
import { FakeUpstream } from '../../../../../../socket-filter/test/helpers/fake-upstream';

const TASK_TOKEN = 'made-up-task-token-aaaa';
const ID = 'T-20261016-ab12';
const NAME = `agentic-ui-task-${ID}`;

const engineConfig: Pick<
  EngineConfig,
  'image' | 'dockerNetwork' | 'project' | 'claudeCodeOauthToken' | 'ghToken' | 'gitName' | 'gitEmail' | 'taskExtraEnv' | 'taskExtraBinds'
> = {
  image: 'agentic-dev:test',
  dockerNetwork: 'agentic-net',
  project: 'proj',
  claudeCodeOauthToken: 'made-up-oauth-token-xxxx',
  ghToken: 'made-up-gh-token-yyyy',
  gitName: 'Made Up Bot',
  gitEmail: 'made-up-bot@example.invalid',
  taskExtraEnv: {},
  taskExtraBinds: [],
};

const spec: LaunchSpec = {
  taskId: ID,
  taskToken: TASK_TOKEN,
  agentToken: 'made-up-agent-token-bbbb',
  prompt: 'do the thing',
  repoUrl: 'https://github.com/o/r.git',
  branch: `agentic/${ID}`,
};

describe('DockerTaskLauncher through the socket filter', () => {
  let upstream: FakeUpstream;
  let filter: FilterServer;
  let dir: string;
  let logs: string[];
  let launcher: DockerTaskLauncher;

  async function startFilter(): Promise<void> {
    const config: FilterConfig = {
      image: engineConfig.image,
      network: engineConfig.dockerNetwork,
      listen: join(dir, 'filter.sock'),
      upstream: upstream.socketPath,
      namePrefix: 'agentic-ui-task-',
      labelPrefix: 'agentic-ui.',
      kindLabel: { key: 'agentic-ui.kind', value: 'task' },
      debug: false,
    };
    filter = await startFilterServer(config, (line) => logs.push(line));
  }

  beforeEach(async () => {
    upstream = await new FakeUpstream().start();
    dir = mkdtempSync(join(tmpdir(), 'launcher-filter-'));
    logs = [];
    await startFilter();
    launcher = new DockerTaskLauncher(engineConfig, new Docker({ socketPath: join(dir, 'filter.sock') }));
  });

  afterEach(async () => {
    await filter.close();
    await upstream.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('launches: the volume and container create pass, the token stays out of the forwarded URL', async () => {
    await expect(launcher.launch(spec)).resolves.toEqual({ bridgeUrl: `http://${NAME}:8765` });
    expect(logs).toEqual([]);
    // dockerode starts the new container by the id the create returned; the filter checks that same id.
    const id = upstream.containers.get(NAME)!.id;
    expect(upstream.paths()).toEqual([
      'POST /volumes/create',
      `POST /containers/create?name=${NAME}`,
      `GET /containers/${id}/json`,
      `POST /containers/${id}/start`,
    ]);
    expect(upstream.requests.some((r) => r.url.includes(TASK_TOKEN))).toBe(false);
    const container = upstream.containers.get(NAME);
    expect(container?.running).toBe(true);
    expect(container?.labels).toEqual({ 'agentic-ui.task': ID, 'agentic-ui.kind': 'task' });
    expect((container?.body as { Env: string[] }).Env).toContain(`AGENTIC_TASK_TOKEN=${TASK_TOKEN}`);
    expect(upstream.volumes.get(NAME)?.Labels).toEqual({ 'agentic-ui.task': ID, 'agentic-ui.kind': 'task' });
  });

  it('runs the whole life cycle without a refusal', async () => {
    await launcher.launch(spec);
    upstream.addContainer('someone-else', { labels: {}, running: true });

    await expect(launcher.inspect(ID)).resolves.toEqual({ exists: true, running: true, bridgeUrl: `http://${NAME}:8765` });
    await expect(launcher.countRunning()).resolves.toBe(1);

    upstream.containers.get(NAME)!.files['/task/ledger.jsonl'] = Buffer.from('{"cost":1}\n'.repeat(2000));
    await expect(launcher.readLedger(ID)).resolves.toBe('{"cost":1}\n'.repeat(2000));

    upstream.containers.get(NAME)!.files[`/work/.worktrees/${ID}/docs/plan.md`] = Buffer.from('# plan');
    await expect(launcher.hasFiles(ID, ['docs/plan.md', 'docs/absent.md'])).resolves.toEqual({ 'docs/plan.md': true, 'docs/absent.md': false });

    await launcher.stop(ID);
    expect(upstream.containers.get(NAME)?.running).toBe(false);
    await launcher.stop(ID); // 304 passes through and is accepted
    await expect(launcher.inspect(ID)).resolves.toMatchObject({ exists: true, running: false });

    await launcher.start(ID);
    expect(upstream.containers.get(NAME)?.running).toBe(true);
    await launcher.start(ID); // 304

    await launcher.remove(ID);
    expect(upstream.containers.has(NAME)).toBe(false);
    expect(upstream.volumes.has(NAME)).toBe(false);

    expect(logs).toEqual([]);
  });

  it('sees a removed task as absent (404 passes through the label check)', async () => {
    await expect(launcher.inspect(ID)).resolves.toMatchObject({ exists: false, running: false });
    await expect(launcher.readLedger(ID)).resolves.toBeUndefined();
    await expect(launcher.remove(ID)).resolves.toBeUndefined();
    expect(logs).toEqual([]);
  });

  it('lists only task containers', async () => {
    await launcher.countRunning();
    const url = new URL(upstream.requests[0].url, 'http://docker');
    expect(JSON.parse(url.searchParams.get('filters') ?? '')).toEqual({ label: ['agentic-ui.kind=task'], status: ['running'] });
  });

  it('cannot launch with extra binds (refused by the filter, and the volume is cleaned up)', async () => {
    launcher = new DockerTaskLauncher(
      { ...engineConfig, taskExtraBinds: ['/home/me/.m2:/home/dev/.m2'] },
      new Docker({ socketPath: join(dir, 'filter.sock') }),
    );
    await expect(launcher.launch(spec)).rejects.toMatchObject({ statusCode: 403 });
    expect(upstream.containers.size).toBe(0);
    expect(upstream.volumes.size).toBe(0);
    expect(logs).toEqual([`docker-filter: refused POST /containers/create: Binds not allowed`]);
  });

  it('refuses to act on a container that is not a task container', async () => {
    upstream.addContainer(NAME, { labels: {}, running: true });
    await expect(launcher.stop(ID)).rejects.toMatchObject({ statusCode: 403 });
    expect(upstream.containers.get(NAME)?.running).toBe(true);
  });
});
