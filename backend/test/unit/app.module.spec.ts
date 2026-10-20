import { Test } from '@nestjs/testing';
import { BacklogApiModule } from '../../src/api/backlog/backlog-api.module';
import { AppModule, backlogModules } from '../../src/app.module';
import { ENGINE_CONFIG } from '../../src/commons/engine-config';
import { TASK_LAUNCHER } from '../../src/engine/service/task-launcher';

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

  it('imports the backlog API only when BACKLOG_CONFIG is set', () => {
    expect(backlogModules({})).toEqual([]);
    expect(backlogModules({ BACKLOG_CONFIG: '  ' })).toEqual([]);
    expect(backlogModules({ BACKLOG_CONFIG: '/etc/backlog.yaml' })).toEqual([BacklogApiModule]);
  });

  it('decides when it is loaded', () => {
    const imports = (): unknown[] => {
      let found: unknown[] = [];
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { AppModule: loaded } = require('../../src/app.module') as typeof import('../../src/app.module');
        found = Reflect.getMetadata('imports', loaded) as unknown[];
      });
      return found.map((m) => (typeof m === 'function' ? m.name : 'dynamic'));
    };
    const saved = process.env.BACKLOG_CONFIG;
    try {
      delete process.env.BACKLOG_CONFIG;
      expect(imports()).not.toContain('BacklogApiModule');
      process.env.BACKLOG_CONFIG = '/etc/backlog.yaml';
      expect(imports()).toContain('BacklogApiModule');
    } finally {
      if (saved === undefined) delete process.env.BACKLOG_CONFIG;
      else process.env.BACKLOG_CONFIG = saved;
    }
  });
});
