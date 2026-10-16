import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { ENGINE_CONFIG } from '../../src/commons/engine-config';
import { TASK_LAUNCHER } from '../../src/repository/tasks/launcher/task-launcher';

describe('AppModule', () => {
  it('compiles', async () => {
    // The real config and launcher need environment variables and Docker; stubbed here.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENGINE_CONFIG)
      .useValue({ dataDir: '/tmp/unused', maxRunning: 1 })
      .overrideProvider(TASK_LAUNCHER)
      .useValue({})
      .compile();
    expect(moduleRef.get(AppModule)).toBeDefined();
  });
});
