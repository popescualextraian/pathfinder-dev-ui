import { createConnector } from '../../../../src/backlog/integration/connector.factory';
import { GitlabConnector } from '../../../../src/backlog/integration/gitlab/gitlab-connector';
import { MemoryConnector } from '../../../../src/backlog/integration/memory/memory-connector';
import { BacklogConfig } from '../../../../src/backlog/service/backlog-config';

const config = (connector: string): BacklogConfig => ({
  connector,
  gitlab: connector === 'gitlab' ? { baseUrl: 'https://gitlab.example.com', project: 'g/p', token: 'made-up' } : undefined,
  memory: connector === 'memory' ? { items: [] } : undefined,
  pollSeconds: 60,
  doneDays: 14,
  dataDir: '/unused',
  lanes: [{ id: 'todo', title: 'Todo', default: true }],
});

describe('createConnector', () => {
  it('creates the gitlab connector', () => {
    expect(createConnector(config('gitlab'), {})).toBeInstanceOf(GitlabConnector);
  });

  it('refuses the memory connector in a normal start, like any unknown connector', () => {
    expect(() => createConnector(config('memory'), {})).toThrow('Unknown backlog connector; known connectors: gitlab');
    expect(() => createConnector(config('memory'), { BACKLOG_ALLOW_MEMORY_CONNECTOR: 'true' })).toThrow('Unknown backlog connector');
    expect(() => createConnector(config('nope'), {})).toThrow('Unknown backlog connector; known connectors: gitlab');
  });

  it('creates the memory connector only with BACKLOG_ALLOW_MEMORY_CONNECTOR=1 (npm run start:local)', () => {
    expect(createConnector(config('memory'), { BACKLOG_ALLOW_MEMORY_CONNECTOR: '1' })).toBeInstanceOf(MemoryConnector);
    expect(() => createConnector(config('nope'), { BACKLOG_ALLOW_MEMORY_CONNECTOR: '1' })).toThrow('known connectors: gitlab, memory');
  });
});
