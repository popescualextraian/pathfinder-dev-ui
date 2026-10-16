import { EngineConfigError, loadEngineConfig } from '../../../src/commons/engine-config';

const TOKEN = 'made-up-oauth-token-123';
const GH = 'made-up-gh-token-456';

function validEnv(): NodeJS.ProcessEnv {
  return {
    ENGINE_IMAGE: 'agentic-task:test',
    ENGINE_DOCKER_NETWORK: 'agentic-net',
    ENGINE_DATA_DIR: '/var/lib/engine',
    ENGINE_REPO_URL: 'https://github.com/example/repo.git',
    ENGINE_PROJECT: 'example',
    CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
    GH_TOKEN: GH,
  };
}

function errorOf(env: NodeJS.ProcessEnv): EngineConfigError {
  try {
    loadEngineConfig(env);
  } catch (e) {
    return e as EngineConfigError;
  }
  throw new Error('expected loadEngineConfig to throw');
}

describe('loadEngineConfig', () => {
  it('reads a valid config and applies defaults', () => {
    expect(loadEngineConfig(validEnv())).toEqual({
      launcher: 'docker',
      image: 'agentic-task:test',
      dockerNetwork: 'agentic-net',
      dataDir: '/var/lib/engine',
      repoUrl: 'https://github.com/example/repo.git',
      project: 'example',
      maxRunning: 2,
      claudeCodeOauthToken: TOKEN,
      ghToken: GH,
      taskExtraEnv: {},
      taskExtraBinds: [],
    });
  });

  it('reads explicit launcher, cap and test hooks', () => {
    const config = loadEngineConfig({
      ...validEnv(),
      ENGINE_LAUNCHER: 'azure',
      ENGINE_MAX_RUNNING: '5',
      ENGINE_TASK_EXTRA_ENV: '{"FAKE_AGENT_STATE":"/tmp/x"}',
      ENGINE_TASK_EXTRA_BINDS: '["/a:/b:ro","/c:/d"]',
    });
    expect(config.launcher).toBe('azure');
    expect(config.maxRunning).toBe(5);
    expect(config.taskExtraEnv).toEqual({ FAKE_AGENT_STATE: '/tmp/x' });
    expect(config.taskExtraBinds).toEqual(['/a:/b:ro', '/c:/d']);
  });

  it.each([
    'ENGINE_IMAGE',
    'ENGINE_DOCKER_NETWORK',
    'ENGINE_DATA_DIR',
    'ENGINE_REPO_URL',
    'ENGINE_PROJECT',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'GH_TOKEN',
  ])('names %s when it is missing', (name) => {
    const env = validEnv();
    delete env[name];
    expect(errorOf(env).message).toContain(name);
    env[name] = '   ';
    expect(errorOf(env).message).toContain(name);
  });

  it('reports every problem at once', () => {
    const message = errorOf({}).message;
    expect(message).toContain('ENGINE_IMAGE');
    expect(message).toContain('GH_TOKEN');
  });

  it.each(['0', '-1', '1.5', 'abc', '2x'])('rejects ENGINE_MAX_RUNNING=%s', (value) => {
    expect(errorOf({ ...validEnv(), ENGINE_MAX_RUNNING: value }).message).toContain('ENGINE_MAX_RUNNING');
  });

  it('requires an absolute ENGINE_DATA_DIR', () => {
    expect(errorOf({ ...validEnv(), ENGINE_DATA_DIR: 'relative/dir' }).message).toContain('ENGINE_DATA_DIR');
  });

  it.each([
    ['ENGINE_TASK_EXTRA_ENV', 'not json'],
    ['ENGINE_TASK_EXTRA_ENV', '["a"]'],
    ['ENGINE_TASK_EXTRA_ENV', '{"A":1}'],
    ['ENGINE_TASK_EXTRA_BINDS', '{"a":"b"}'],
    ['ENGINE_TASK_EXTRA_BINDS', '[1]'],
    ['ENGINE_TASK_EXTRA_BINDS', '["nocolon"]'],
    ['ENGINE_TASK_EXTRA_BINDS', '["/a:/b:xx"]'],
  ])('rejects %s=%s', (name, value) => {
    expect(errorOf({ ...validEnv(), [name]: value }).message).toContain(name);
  });

  it('never puts secret values in error text, even when other values are invalid', () => {
    const env = { ...validEnv(), ENGINE_MAX_RUNNING: '0', ENGINE_DATA_DIR: 'rel', ENGINE_TASK_EXTRA_ENV: `{"A":"${TOKEN}"` };
    const message = errorOf(env).message;
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain(GH);
    const missingOne = validEnv();
    delete missingOne.ENGINE_IMAGE;
    expect(errorOf(missingOne).message).not.toContain(TOKEN);
    expect(errorOf({ ...missingOne, ENGINE_TASK_EXTRA_ENV: `{"A":1,"T":"${TOKEN}"}` }).message).not.toContain(TOKEN);
  });
});
