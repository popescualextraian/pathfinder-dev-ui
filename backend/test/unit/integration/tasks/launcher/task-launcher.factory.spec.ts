import { EngineConfig } from '../../../../../src/commons/engine-config';
import { DockerTaskLauncher } from '../../../../../src/integration/tasks/launcher/docker-task-launcher';
import { LocalTaskLauncher } from '../../../../../src/integration/tasks/launcher/local-task-launcher';
import { createTaskLauncher } from '../../../../../src/integration/tasks/launcher/task-launcher.factory';

const config = { launcher: 'docker', image: 'i', dockerNetwork: 'n', project: 'p', taskExtraEnv: {}, taskExtraBinds: [] } as unknown as EngineConfig;

describe('createTaskLauncher', () => {
  it('returns the Docker launcher for "docker"', () => {
    expect(createTaskLauncher(config)).toBeInstanceOf(DockerTaskLauncher);
  });

  it('returns the local launcher for "local"', () => {
    expect(createTaskLauncher({ ...config, launcher: 'local', localAgent: 'fake', dataDir: '/tmp/x' })).toBeInstanceOf(LocalTaskLauncher);
  });

  it('refuses an unknown launcher, naming it and the known ones', () => {
    expect(() => createTaskLauncher({ ...config, launcher: 'azure' })).toThrow(/"azure".*docker/);
  });
});
