import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { BRIDGE_CLIENT_FACTORY } from '../../src/repository/tasks/bridge/bridge-client.factory';
import { TASK_LAUNCHER } from '../../src/repository/tasks/launcher/task-launcher';
import { FakeLauncher } from '../helpers/fake-launcher';
import { setTestEnv } from '../helpers/test-env';

export interface CreateAppOptions {
  launcher?: FakeLauncher;
  bridgeClientFactory?: unknown;
  // ENGINE_MAX_RUNNING for this app.
  maxRunning?: number;
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
  return { app, dataDir, launcher };
}
