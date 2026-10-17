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
    ENGINE_GIT_NAME: 'Made Up Bot',
    ENGINE_GIT_EMAIL: 'made-up-bot@example.invalid',
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
      localAgent: 'fake',
      image: 'agentic-task:test',
      dockerNetwork: 'agentic-net',
      dataDir: '/var/lib/engine',
      repoUrl: 'https://github.com/example/repo.git',
      project: 'example',
      maxRunning: 2,
      claudeCodeOauthToken: TOKEN,
      ghToken: GH,
      gitName: 'Made Up Bot',
      gitEmail: 'made-up-bot@example.invalid',
      allowedRepoHosts: ['github.com'],
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
    'ENGINE_GIT_NAME',
    'ENGINE_GIT_EMAIL',
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

  describe('repository hosts and credentials', () => {
    it('allows the host of ENGINE_REPO_URL plus ENGINE_ALLOWED_REPO_HOSTS, lower-cased', () => {
      const config = loadEngineConfig({ ...validEnv(), ENGINE_ALLOWED_REPO_HOSTS: ' GitLab.com, git.example.org ,,' });
      expect(config.allowedRepoHosts).toEqual(['github.com', 'gitlab.com', 'git.example.org']);
    });

    it('allows a local path as ENGINE_REPO_URL and then no host by default', () => {
      expect(loadEngineConfig({ ...validEnv(), ENGINE_REPO_URL: '/seed/repo' }).allowedRepoHosts).toEqual([]);
    });

    it('rejects credentials in ENGINE_REPO_URL, naming the variable but not the value', () => {
      const error = errorOf({ ...validEnv(), ENGINE_REPO_URL: 'https://x:ghp_secret@github.com/o/r.git' });
      expect(error.message).toContain('ENGINE_REPO_URL');
      expect(error.message).not.toContain('ghp_secret');
    });
  });

  describe('ENGINE_TASK_EXTRA_ENV keys', () => {
    it.each(['AGENTIC_TASK_TOKEN', 'AGENTIC_AGENT_TOKEN', 'AGENTIC_TASK_ID', 'AGENTIC_BRIDGE_HOSTS', 'AGENTIC_TASK_DIR',
      'GH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'AGENTIC_BRANCH', 'AGENTIC_WORKTREE', 'AGENTIC_ALLOWED_ACTIONS',
      'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL',
      'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_3', 'GIT_CONFIG_KEY_12'])(
      'refuses the engine-managed key %s', (key) => {
        const error = errorOf({ ...validEnv(), ENGINE_TASK_EXTRA_ENV: JSON.stringify({ [key]: 'v-secret' }) });
        expect(error.message).toContain(key);
        expect(error.message).not.toContain('v-secret');
      });

    it.each(['', 'A=B', '1X', 'a-b'])('refuses the malformed key %j', (key) => {
      expect(errorOf({ ...validEnv(), ENGINE_TASK_EXTRA_ENV: JSON.stringify({ [key]: 'v' }) }).message).toContain('ENGINE_TASK_EXTRA_ENV');
    });

    it('still allows AGENTIC_REPO_URL and AGENTIC_ACP_CMD', () => {
      const extra = { AGENTIC_REPO_URL: '/seed/repo', AGENTIC_ACP_CMD: 'x' };
      expect(loadEngineConfig({ ...validEnv(), ENGINE_TASK_EXTRA_ENV: JSON.stringify(extra) }).taskExtraEnv).toEqual(extra);
    });
  });

  describe('launcher local', () => {
    const localEnv = (): NodeJS.ProcessEnv => ({
      ENGINE_LAUNCHER: 'local',
      ENGINE_DATA_DIR: '/var/lib/engine',
      ENGINE_REPO_URL: '/some/checkout',
      ENGINE_PROJECT: 'example',
    });

    it('needs no image, network, tokens or identity with the fake agent (default)', () => {
      const config = loadEngineConfig(localEnv());
      expect(config).toMatchObject({ launcher: 'local', localAgent: 'fake', image: '', dockerNetwork: '', claudeCodeOauthToken: '', ghToken: '', gitName: '', gitEmail: '' });
    });

    it('requires data dir, repo and project', () => {
      expect(errorOf({ ENGINE_LAUNCHER: 'local' }).problems).toEqual([
        'ENGINE_DATA_DIR is required', 'ENGINE_REPO_URL is required', 'ENGINE_PROJECT is required',
      ]);
    });

    it('refuses an unknown agent naming the variable, not the value', () => {
      const error = errorOf({ ...localEnv(), ENGINE_LOCAL_AGENT: 'secret-agent-name' });
      expect(error.problems).toEqual(['ENGINE_LOCAL_AGENT must be fake or claude']);
      expect(error.message).not.toContain('secret-agent-name');
    });

    it('requires the Claude token only for the claude agent', () => {
      expect(errorOf({ ...localEnv(), ENGINE_LOCAL_AGENT: 'claude' }).problems).toEqual(['CLAUDE_CODE_OAUTH_TOKEN is required']);
      expect(loadEngineConfig({ ...localEnv(), ENGINE_LOCAL_AGENT: 'claude', CLAUDE_CODE_OAUTH_TOKEN: TOKEN })).toMatchObject({ localAgent: 'claude', claudeCodeOauthToken: TOKEN });
    });

    it('requires the git identity only when GH_TOKEN is set', () => {
      const error = errorOf({ ...localEnv(), GH_TOKEN: GH });
      expect(error.problems).toEqual(['ENGINE_GIT_NAME is required when GH_TOKEN is set', 'ENGINE_GIT_EMAIL is required when GH_TOKEN is set']);
      expect(error.message).not.toContain(GH);
      expect(loadEngineConfig({ ...localEnv(), GH_TOKEN: GH, ENGINE_GIT_NAME: 'n', ENGINE_GIT_EMAIL: 'e@x' })).toMatchObject({ ghToken: GH, gitName: 'n' });
    });
  });

  it('keeps the Docker rules: image, network, tokens and identity stay required', () => {
    expect(errorOf({ ENGINE_DATA_DIR: '/d', ENGINE_REPO_URL: '/r', ENGINE_PROJECT: 'p' }).problems).toEqual([
      'ENGINE_IMAGE is required', 'ENGINE_DOCKER_NETWORK is required', 'CLAUDE_CODE_OAUTH_TOKEN is required',
      'GH_TOKEN is required', 'ENGINE_GIT_NAME is required', 'ENGINE_GIT_EMAIL is required',
    ]);
  });

  it('ignores ENGINE_LOCAL_AGENT for docker', () => {
    expect(loadEngineConfig({ ...validEnv(), ENGINE_LOCAL_AGENT: 'bogus' }).localAgent).toBe('fake');
  });
});
