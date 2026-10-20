import { BacklogConfig } from '../service/backlog-config';
import { BacklogConnector } from '../service/backlog-connector';
import { GitlabClient } from './gitlab/gitlab-client';
import { GitlabConnector } from './gitlab/gitlab-connector';

const CONNECTORS: Record<string, (config: BacklogConfig) => BacklogConnector> = {
  gitlab: (config) => {
    if (!config.gitlab) throw new Error('The gitlab connector needs the gitlab settings');
    const { baseUrl, project, token } = config.gitlab;
    return new GitlabConnector(config, new GitlabClient(baseUrl, project, token));
  },
};

export function createConnector(config: BacklogConfig): BacklogConnector {
  const create = CONNECTORS[config.connector];
  if (!Object.hasOwn(CONNECTORS, config.connector) || !create) {
    throw new Error(`Unknown backlog connector; known connectors: ${Object.keys(CONNECTORS).join(', ')}`);
  }
  return create(config);
}
