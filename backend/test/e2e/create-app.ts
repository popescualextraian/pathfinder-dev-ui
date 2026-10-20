import { INestApplication } from '@nestjs/common';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { BacklogApiModule } from '../../src/api/backlog/backlog-api.module';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { BRIDGE_CLIENT_FACTORY } from '../../src/engine/service/bridge-client';
import { TASK_LAUNCHER } from '../../src/engine/service/task-launcher';
import { FakeGitlab } from '../helpers/fake-gitlab';
import { FakeLauncher } from '../helpers/fake-launcher';
import { setTestEnv } from '../helpers/test-env';

export interface CreateAppOptions {
  launcher?: FakeLauncher;
  bridgeClientFactory?: unknown;
  // ENGINE_MAX_RUNNING for this app.
  maxRunning?: number;
  // Extra ENGINE_* variables (ENGINE_REPOS, ENGINE_POLL_SECONDS); the optional ones are reset first.
  env?: Record<string, string>;
  // Switches the backlog component on against this fake GitLab (BACKLOG_CONFIG, BACKLOG_DATA_DIR and the
  // token variable are set for the app and unset again when it closes). Without it the component is off.
  backlog?: { gitlab: FakeGitlab; pollSeconds?: number };
}

export interface TestApp {
  app: INestApplication;
  dataDir: string;
  launcher: FakeLauncher;
}

const BACKLOG_VARIABLES = ['BACKLOG_CONFIG', 'BACKLOG_DATA_DIR', 'BACKLOG_TEST_TOKEN'];

const LANES_YAML = `lanes:
  - { id: backlog, title: Backlog, default: true, gitlab: { label: 'status::backlog' } }
  - { id: doing, title: Doing, trigger: start-work, gitlab: { label: 'status::doing' } }
  - { id: done, title: Done, gitlab: { state: closed, label: 'status::done' } }
`;

// Sets the test environment (made-up config and secrets, temporary data dir) and starts the whole
// app with an in-memory launcher instead of Docker. The app listens on a free port (raw HTTP clients
// need it, e.g. for SSE).
export async function createApp(options: CreateAppOptions = {}): Promise<TestApp> {
  const dataDir = setTestEnv(options.maxRunning);
  delete process.env.ENGINE_REPOS;
  delete process.env.ENGINE_POLL_SECONDS;
  Object.assign(process.env, options.env);
  for (const name of BACKLOG_VARIABLES) delete process.env[name];
  if (options.backlog) {
    const { gitlab, pollSeconds = 3600 } = options.backlog;
    const configFile = join(dataDir, 'backlog.yaml');
    writeFileSync(configFile, `connector: gitlab
pollSeconds: ${pollSeconds}
gitlab: { baseUrl: '${gitlab.baseUrl}', project: '${FakeGitlab.PROJECT}', tokenEnv: BACKLOG_TEST_TOKEN }
${LANES_YAML}`);
    Object.assign(process.env, {
      BACKLOG_CONFIG: configFile,
      BACKLOG_DATA_DIR: join(dataDir, 'backlog'),
      BACKLOG_TEST_TOKEN: gitlab.token,
    });
  }
  const launcher = options.launcher ?? new FakeLauncher();
  // AppModule decides at load time whether it has the backlog; tests that want it add the module here.
  let builder = Test.createTestingModule({ imports: options.backlog ? [AppModule, BacklogApiModule] : [AppModule] })
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
