import { INestApplication } from '@nestjs/common';
import { rmSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { BRIDGE_CLIENT_FACTORY } from '../../src/service/tasks/bridge-client';
import { TASK_LAUNCHER } from '../../src/service/tasks/task-launcher';
import { FakeLauncher } from '../helpers/fake-launcher';
import { setTestEnv } from '../helpers/test-env';

export interface CreateAppOptions {
  launcher?: FakeLauncher;
  bridgeClientFactory?: unknown;
  // ENGINE_MAX_RUNNING for this app.
  maxRunning?: number;
  // Extra ENGINE_* variables (ENGINE_REPOS, ENGINE_POLL_SECONDS); the optional ones are reset first.
  env?: Record<string, string>;
}

export interface TestApp {
  app: INestApplication;
  dataDir: string;
  launcher: FakeLauncher;
}

// Sets the test environment (made-up config and secrets, temporary data dir) and starts the whole
// app with an in-memory launcher instead of Docker. The app listens on a free port (raw HTTP clients
// need it, e.g. for SSE).
export async function createApp(options: CreateAppOptions = {}): Promise<TestApp> {
  const dataDir = setTestEnv(options.maxRunning);
  delete process.env.ENGINE_REPOS;
  delete process.env.ENGINE_POLL_SECONDS;
  Object.assign(process.env, options.env);
  const launcher = options.launcher ?? new FakeLauncher();
  let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(TASK_LAUNCHER).useValue(launcher);
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
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { app, dataDir, launcher };
}
