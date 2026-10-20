import { INestApplication } from '@nestjs/common';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { BacklogApiModule } from '../../src/api/backlog/backlog-api.module';
import { WorkflowsApiModule } from '../../src/api/workflows/workflows-api.module';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { BRIDGE_CLIENT_FACTORY } from '../../src/engine/service/bridge-client';
import { TASK_LAUNCHER, TaskLauncher } from '../../src/engine/service/task-launcher';
import { FakeGitlab } from '../helpers/fake-gitlab';
import { FakeLauncher } from '../helpers/fake-launcher';
import { setTestEnv } from '../helpers/test-env';

export interface CreateAppOptions<L extends TaskLauncher = FakeLauncher> {
  // Default: a FakeLauncher; the bridge suite passes a LocalProcessLauncher (real bridge, fake agent).
  launcher?: L;
  bridgeClientFactory?: unknown;
  // ENGINE_MAX_RUNNING for this app.
  maxRunning?: number;
  // Extra ENGINE_* variables (ENGINE_REPOS, ENGINE_POLL_SECONDS); the optional ones are reset first.
  env?: Record<string, string>;
  // Switches the backlog component on against this fake GitLab (BACKLOG_CONFIG, BACKLOG_DATA_DIR and the
  // token variable are set for the app and unset again when it closes). Without it the component is off.
  // `lanes`: the `lanes:` YAML block instead of the default backlog/doing/done lanes.
  backlog?: { gitlab: FakeGitlab; pollSeconds?: number; lanes?: string };
  // Switches workflows on (needs `backlog`): these definition files (name -> YAML) in WORKFLOWS_DIR, runs in
  // WORKFLOWS_DATA_DIR, both under the data dir.
  workflows?: Record<string, string>;
}

export interface TestApp<L extends TaskLauncher = FakeLauncher> {
  app: INestApplication;
  dataDir: string;
  launcher: L;
}

const BACKLOG_VARIABLES = ['BACKLOG_CONFIG', 'BACKLOG_DATA_DIR', 'BACKLOG_TEST_TOKEN', 'WORKFLOWS_DIR', 'WORKFLOWS_DATA_DIR'];

const LANES_YAML = `lanes:
  - { id: backlog, title: Backlog, default: true, gitlab: { label: 'status::backlog' } }
  - { id: doing, title: Doing, trigger: start-work, gitlab: { label: 'status::doing' } }
  - { id: done, title: Done, gitlab: { state: closed, label: 'status::done' } }
`;

// Sets the test environment (made-up config and secrets, temporary data dir) and starts the whole
// app with an in-memory launcher instead of Docker. The app listens on a free port (raw HTTP clients
// need it, e.g. for SSE).
export async function createApp<L extends TaskLauncher = FakeLauncher>(options: CreateAppOptions<L> = {}): Promise<TestApp<L>> {
  const dataDir = setTestEnv(options.maxRunning);
  delete process.env.ENGINE_REPOS;
  delete process.env.ENGINE_POLL_SECONDS;
  Object.assign(process.env, options.env);
  for (const name of BACKLOG_VARIABLES) delete process.env[name];
  if (options.backlog) {
    const { gitlab, pollSeconds = 3600, lanes = LANES_YAML } = options.backlog;
    const configFile = join(dataDir, 'backlog.yaml');
    writeFileSync(configFile, `connector: gitlab
pollSeconds: ${pollSeconds}
gitlab: { baseUrl: '${gitlab.baseUrl}', project: '${FakeGitlab.PROJECT}', tokenEnv: BACKLOG_TEST_TOKEN }
${lanes}`);
    Object.assign(process.env, {
      BACKLOG_CONFIG: configFile,
      BACKLOG_DATA_DIR: join(dataDir, 'backlog'),
      BACKLOG_TEST_TOKEN: gitlab.token,
    });
  }
  if (options.workflows) {
    const dir = join(dataDir, 'workflows');
    mkdirSync(dir);
    for (const [file, yaml] of Object.entries(options.workflows)) writeFileSync(join(dir, file), yaml);
    Object.assign(process.env, { WORKFLOWS_DIR: dir, WORKFLOWS_DATA_DIR: join(dataDir, 'workflow-runs') });
  }
  const launcher = options.launcher ?? (new FakeLauncher() as unknown as L);
  // AppModule decides at load time whether it has the backlog and workflows; tests that want them add the modules here.
  const imports = [AppModule, ...(options.backlog ? [BacklogApiModule] : []), ...(options.workflows ? [WorkflowsApiModule] : [])];
  let builder = Test.createTestingModule({ imports })
    .overrideProvider(TASK_LAUNCHER)
    .useValue(launcher);
  if (options.bridgeClientFactory) {
    builder = builder.overrideProvider(BRIDGE_CLIENT_FACTORY).useValue(options.bridgeClientFactory);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  await app.listen(0, '127.0.0.1');
  // The data directory goes away with the app.
  const close = app.close.bind(app);
  app.close = async () => {
    await close();
    for (const name of BACKLOG_VARIABLES) delete process.env[name];
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { app, dataDir, launcher };
}
