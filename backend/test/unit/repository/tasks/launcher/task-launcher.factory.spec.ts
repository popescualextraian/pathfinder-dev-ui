import { EngineConfig } from '../../../../../src/commons/engine-config';
import { DockerTaskLauncher } from '../../../../../src/repository/tasks/launcher/docker-task-launcher';
import { createTaskLauncher } from '../../../../../src/repository/tasks/launcher/task-launcher.factory';

const config = { launcher: 'docker', image: 'i', dockerNetwork: 'n', project: 'p', taskExtraEnv: {}, taskExtraBinds: [] } as unknown as EngineConfig;

describe('createTaskLauncher', () => {
  it('returns the Docker launcher for "docker"', () => {
    expect(createTaskLauncher(config)).toBeInstanceOf(DockerTaskLauncher);
  });

  it('refuses an unknown launcher, naming it and the known ones', () => {
    expect(() => createTaskLauncher({ ...config, launcher: 'azure' })).toThrow(/"azure".*docker/);
  });
});
