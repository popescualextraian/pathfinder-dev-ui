import { EngineConfig } from '../../../commons/engine-config';
import { DockerTaskLauncher } from './docker-task-launcher';
import { LocalTaskLauncher } from './local-task-launcher';
import { TaskLauncher } from '../../../service/tasks/task-launcher';

const LAUNCHERS: Record<string, (config: EngineConfig) => TaskLauncher> = {
  docker: (config) => new DockerTaskLauncher(config),
  local: (config) => new LocalTaskLauncher(config),
};

export function createTaskLauncher(config: EngineConfig): TaskLauncher {
  const create = LAUNCHERS[config.launcher];
  if (!Object.hasOwn(LAUNCHERS, config.launcher) || !create) {
    throw new Error(`Unknown ENGINE_LAUNCHER "${config.launcher}"; known: ${Object.keys(LAUNCHERS).join(', ')}`);
  }
  return create(config);
}
