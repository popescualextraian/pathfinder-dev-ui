import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacklogApiModule } from '../../src/api/backlog/backlog-api.module';
import { WorkflowsApiModule } from '../../src/api/workflows/workflows-api.module';
import { AppModule, backlogModules, workflowModules } from '../../src/app.module';
import { BACKLOG_CONFIG } from '../../src/backlog/service/backlog-config';
import { ENGINE_CONFIG } from '../../src/commons/engine-config';
import { TASK_LAUNCHER } from '../../src/engine/service/task-launcher';
import { WorkflowDefinitionsService, WorkflowRunner } from '../../src/workflow';

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

  it('imports the workflow API only when BACKLOG_CONFIG and WORKFLOWS_DIR are both set', () => {
    expect(workflowModules({})).toEqual([]);
    expect(workflowModules({ WORKFLOWS_DIR: '/etc/workflows' })).toEqual([]); // no backlog: no routes, no error
    expect(workflowModules({ BACKLOG_CONFIG: '/etc/backlog.yaml' })).toEqual([]);
    expect(workflowModules({ BACKLOG_CONFIG: '/etc/backlog.yaml', WORKFLOWS_DIR: ' ' })).toEqual([]);
    expect(workflowModules({ BACKLOG_CONFIG: '/etc/backlog.yaml', WORKFLOWS_DIR: '/etc/workflows' })).toEqual([WorkflowsApiModule]);
  });

  describe('workflow wiring', () => {
    const NAMES = ['WORKFLOWS_DIR', 'WORKFLOWS_DATA_DIR'];
    let saved: Record<string, string | undefined>;
    let dir: string;
    beforeEach(() => {
      saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
      dir = mkdtempSync(join(tmpdir(), 'wfwire-'));
    });
    afterEach(() => {
      for (const n of NAMES) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
      rmSync(dir, { recursive: true, force: true });
    });

    // The backlog config and the launcher are stubbed: the real ones need a lanes file, a token and Docker.
    const compile = () => Test.createTestingModule({ imports: [WorkflowsApiModule] })
      .overrideProvider(ENGINE_CONFIG)
      .useValue({ dataDir: join(dir, 'tasks'), maxRunning: 1 })
      .overrideProvider(TASK_LAUNCHER)
      .useValue({})
      .overrideProvider(BACKLOG_CONFIG)
      .useValue({ connector: 'gitlab', gitlab: { baseUrl: 'http://127.0.0.1:9', project: 'p', token: 'made-up' }, pollSeconds: 3600, doneDays: 14, dataDir: join(dir, 'backlog'), lanes: [{ id: 'todo', title: 'To do', default: true }] })
      .compile();

    it('wires the runner with the file repositories from WORKFLOWS_DIR and WORKFLOWS_DATA_DIR', async () => {
      process.env.WORKFLOWS_DIR = join(dir, 'defs');
      process.env.WORKFLOWS_DATA_DIR = join(dir, 'runs');
      const moduleRef = await compile();
      const runner = moduleRef.get(WorkflowRunner);
      // the folder does not exist here, so it is not writable
      expect(await moduleRef.get(WorkflowDefinitionsService).list()).toEqual({ definitions: [], refused: [], versions: {}, writable: false });
      expect(await runner.list()).toEqual([]);
    });

    it.each([
      [{}, 'WORKFLOWS_DATA_DIR is required'],
      [{ WORKFLOWS_DATA_DIR: 'relative/runs' }, 'WORKFLOWS_DATA_DIR must be an absolute path'],
    ])('refuses to start with %p, naming the variable without its value', async (env, problem) => {
      process.env.WORKFLOWS_DIR = join(dir, 'defs');
      delete process.env.WORKFLOWS_DATA_DIR;
      Object.assign(process.env, env);
      const failure = compile();
      await expect(failure).rejects.toThrow(problem);
      await expect(failure).rejects.not.toThrow('relative/runs');
    });
  });
});
