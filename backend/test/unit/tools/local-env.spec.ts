import { resolve } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildAppEnv, isRepoUrl, redactRepoUrl } = require(resolve(__dirname, '../../../../tools/local-env.cjs'));

const build = (processEnv: Record<string, string | undefined>) =>
  buildAppEnv({ processEnv, root: '/co', projectName: 'co', port: '3100', dataDir: '/co/.local/3100' }) as Record<string, string>;

describe('buildAppEnv', () => {
  it('defaults, with the environment overriding and the launcher settings fixed', () => {
    expect(build({ ENGINE_LAUNCHER: 'docker', PORT: '1', ENGINE_PROJECT: 'x', EMPTY: '' })).toMatchObject({
      ENGINE_REPO_URL: '/co', ENGINE_PROJECT: 'x', ENGINE_LOCAL_AGENT: 'fake', ENGINE_GIT_NAME: 'Local Dev',
      ENGINE_LAUNCHER: 'local', PORT: '3100', ENGINE_DATA_DIR: '/co/.local/3100',
    });
    expect(build({ EMPTY: '' })).not.toHaveProperty('EMPTY');
  });

  it('fake agent: drops the OAuth token, and GH_TOKEN for a local path repository', () => {
    const env = build({ CLAUDE_CODE_OAUTH_TOKEN: 'o', GH_TOKEN: 'g', PATH: '/bin' });
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(env).not.toHaveProperty('GH_TOKEN');
    expect(env.PATH).toBe('/bin');
    expect(env.ENGINE_GIT_NAME).toBe('Local Dev');
  });

  it('fake agent with a URL repository keeps GH_TOKEN (and the default identity)', () => {
    const env = build({ CLAUDE_CODE_OAUTH_TOKEN: 'o', GH_TOKEN: 'g', ENGINE_REPO_URL: 'https://github.com/a/b.git' });
    expect(env.GH_TOKEN).toBe('g');
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(env.ENGINE_GIT_EMAIL).toBe('local-dev@example.invalid');
  });

  it('passes the backlog variables and its token through, with either agent', () => {
    const backlog = { BACKLOG_CONFIG: '/c.yaml', BACKLOG_DATA_DIR: '/d', GITLAB_TOKEN: 't' };
    expect(build(backlog)).toMatchObject(backlog);
    expect(build({ ...backlog, ENGINE_LOCAL_AGENT: 'claude' })).toMatchObject(backlog);
  });

  it('allows the memory backlog connector (only start:local does)', () => {
    expect(build({}).BACKLOG_ALLOW_MEMORY_CONNECTOR).toBe('1');
    expect(build({ BACKLOG_ALLOW_MEMORY_CONNECTOR: '0' }).BACKLOG_ALLOW_MEMORY_CONNECTOR).toBe('1');
  });

  it('passes the workflow variables through, made absolute against the checkout', () => {
    const env = build({ BACKLOG_CONFIG: '/c.yaml', BACKLOG_DATA_DIR: '/d', WORKFLOWS_DIR: 'e2e/fixtures/workflows', WORKFLOWS_DATA_DIR: '/runs' });
    expect(env).toMatchObject({ BACKLOG_CONFIG: '/c.yaml', BACKLOG_DATA_DIR: '/d', WORKFLOWS_DIR: '/co/e2e/fixtures/workflows', WORKFLOWS_DATA_DIR: '/runs' });
    expect(build({ WORKFLOWS_DIR: '/w', WORKFLOWS_DATA_DIR: 'runs' }).WORKFLOWS_DATA_DIR).toBe('/co/runs');
  });

  it('puts the backlog and workflow data under the data dir unless given', () => {
    const env = build({ BACKLOG_CONFIG: 'e2e/fixtures/backlog.yaml', WORKFLOWS_DIR: '/w' });
    expect(env).toMatchObject({
      BACKLOG_CONFIG: '/co/e2e/fixtures/backlog.yaml', BACKLOG_DATA_DIR: '/co/.local/3100/backlog', WORKFLOWS_DATA_DIR: '/co/.local/3100/workflow-runs',
    });
    const off = build({});
    for (const name of ['BACKLOG_CONFIG', 'BACKLOG_DATA_DIR', 'WORKFLOWS_DIR', 'WORKFLOWS_DATA_DIR']) expect(off).not.toHaveProperty(name);
  });

  it('claude agent keeps both tokens', () => {
    const env = build({ ENGINE_LOCAL_AGENT: 'claude', CLAUDE_CODE_OAUTH_TOKEN: 'o', GH_TOKEN: 'g' });
    expect(env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: 'o', GH_TOKEN: 'g' });
  });
});

describe('repo url helpers', () => {
  it('recognises URLs and scp-like addresses, not paths', () => {
    expect(isRepoUrl('https://x/y')).toBe(true);
    expect(isRepoUrl('git@github.com:a/b.git')).toBe(true);
    expect(isRepoUrl('/home/me/repo')).toBe(false);
    expect(isRepoUrl('../rel')).toBe(false);
  });

  it('strips userinfo for printing', () => {
    expect(redactRepoUrl('https://user:secret@github.com/a/b.git')).toBe('https://github.com/a/b.git');
    expect(redactRepoUrl('https://tok@github.com/a')).toBe('https://github.com/a');
    expect(redactRepoUrl('/path/with@at')).toBe('/path/with@at');
  });
});
