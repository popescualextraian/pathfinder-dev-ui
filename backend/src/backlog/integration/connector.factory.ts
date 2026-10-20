import { BacklogConfig } from '../service/backlog-config';
import { BacklogConnector } from '../service/backlog-connector';
import { GitlabClient } from './gitlab/gitlab-client';
import { GitlabConnector } from './gitlab/gitlab-connector';
import { MemoryConnector } from './memory/memory-connector';

const CONNECTORS: Record<string, (config: BacklogConfig) => BacklogConnector> = {
  gitlab: (config) => {
    if (!config.gitlab) throw new Error('The gitlab connector needs the gitlab settings');
    const { baseUrl, project, token } = config.gitlab;
    return new GitlabConnector(config, new GitlabClient(baseUrl, project, token));
  },
};

// In-memory items, gone at restart: only for `npm run start:local` (UI tests, trying the board without GitLab), which
// sets BACKLOG_ALLOW_MEMORY_CONNECTOR=1. Any other start refuses it like an unknown connector.
const DEVELOPMENT_CONNECTORS: Record<string, (config: BacklogConfig) => BacklogConnector> = {
  memory: (config) => new MemoryConnector(config),
};

export function createConnector(config: BacklogConfig, env: NodeJS.ProcessEnv = process.env): BacklogConnector {
  const known = env.BACKLOG_ALLOW_MEMORY_CONNECTOR === '1' ? { ...CONNECTORS, ...DEVELOPMENT_CONNECTORS } : CONNECTORS;
  const create = known[config.connector];
  if (!Object.hasOwn(known, config.connector) || !create) {
    throw new Error(`Unknown backlog connector; known connectors: ${Object.keys(known).join(', ')}`);
  }
  return create(config);
}
