import { Logger } from '@nestjs/common';
import { EngineConfig } from '../../../../../src/commons/engine-config';
import { DockerTaskLauncher } from '../../../../../src/integration/tasks/launcher/docker-task-launcher';
import { LocalTaskLauncher } from '../../../../../src/integration/tasks/launcher/local-task-launcher';
import { createTaskLauncher } from '../../../../../src/integration/tasks/launcher/task-launcher.factory';

const config = { launcher: 'docker', image: 'i', dockerNetwork: 'n', project: 'p', taskExtraEnv: {}, taskExtraBinds: [] } as unknown as EngineConfig;

describe('createTaskLauncher', () => {
  beforeEach(() => { jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
  afterEach(() => jest.restoreAllMocks());

  it('returns the Docker launcher for "docker"', () => {
    expect(createTaskLauncher(config)).toBeInstanceOf(DockerTaskLauncher);
  });

  it('returns the local launcher for "local"', () => {
    expect(createTaskLauncher({ ...config, launcher: 'local', localAgent: 'fake', dataDir: '/tmp/x' })).toBeInstanceOf(LocalTaskLauncher);
  });

  it('warns at creation that the local launcher has no isolation, and only for it', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      createTaskLauncher(config);
      expect(warn).not.toHaveBeenCalled();
      createTaskLauncher({ ...config, launcher: 'local', localAgent: 'fake', dataDir: '/tmp/x' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/local launcher.*no isolation.*development only/i);
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses an unknown launcher, naming the variable and the known ones but not the value', () => {
    expect(() => createTaskLauncher({ ...config, launcher: 'azure-secret' })).toThrow(/ENGINE_LAUNCHER.*docker, local/);
    expect(() => createTaskLauncher({ ...config, launcher: 'azure-secret' })).not.toThrow(/azure-secret/);
  });
});
