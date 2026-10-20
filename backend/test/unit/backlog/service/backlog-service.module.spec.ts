import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { BacklogService } from '../../../../src/backlog';
import { BacklogServiceModule } from '../../../../src/backlog';
import { FakeGitlab } from '../../../helpers/fake-gitlab';

describe('BacklogServiceModule wiring', () => {
  let dir: string;
  const saved = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'backlog-module-'));
  });
  afterEach(() => {
    process.env = { ...saved };
    rmSync(dir, { recursive: true, force: true });
  });

  function configure(baseUrl: string, token: string): void {
    const file = join(dir, 'backlog.yaml');
    writeFileSync(file, [
      'connector: gitlab',
      'gitlab:',
      `  baseUrl: ${baseUrl}`,
      `  project: ${FakeGitlab.PROJECT}`,
      '  tokenEnv: TEST_GITLAB_TOKEN',
      'lanes:',
      '  - { id: todo, title: Todo, default: true, gitlab: { label: "status::todo" } }',
      '  - { id: done, title: Done, gitlab: { state: closed } }',
    ].join('\n'));
    process.env.BACKLOG_CONFIG = file;
    process.env.BACKLOG_DATA_DIR = join(dir, 'data');
    process.env.TEST_GITLAB_TOKEN = token;
  }

  it('resolves BacklogService and the first poll lists from the source', async () => {
    const gitlab = new FakeGitlab();
    await gitlab.start();
    gitlab.addIssue({ title: 'one' });
    configure(gitlab.baseUrl, gitlab.token);
    const moduleRef = await Test.createTestingModule({ imports: [BacklogServiceModule] }).compile();
    try {
      await moduleRef.init();
      const service = moduleRef.get(BacklogService);
      expect((await service.refresh()).map((i) => i.title)).toEqual(['one']);
    } finally {
      await moduleRef.close();
      await gitlab.stop();
    }
  });

  it('tolerates an unreachable source at start', async () => {
    configure('http://127.0.0.1:1', 'whatever');
    const moduleRef = await Test.createTestingModule({ imports: [BacklogServiceModule] }).compile();
    try {
      await moduleRef.init();
      expect(moduleRef.get(BacklogService)).toBeInstanceOf(BacklogService);
      await expect(moduleRef.get(BacklogService).list()).resolves.toEqual([]);
    } finally {
      await moduleRef.close();
    }
  });
});
