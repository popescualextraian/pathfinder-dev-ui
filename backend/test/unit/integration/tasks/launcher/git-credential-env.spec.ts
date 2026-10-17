import { gitCredentialEnv } from '../../../../../src/integration/tasks/launcher/git-credential-env';

// Byte-identical to the helper in agentic-dev-base's gitenv.sh (git_cred_env).
const HELPER = '!f() { test "$1" = get && printf "username=x-access-token\\npassword=%s\\n" "${GH_TOKEN:-$GIT_TOKEN}"; }; f';

describe('gitCredentialEnv', () => {
  it('returns exactly the entries git_cred_env produces for the host', () => {
    expect(gitCredentialEnv('https://github.com/o/r.git')).toEqual({
      GIT_CONFIG_COUNT: '4',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: HELPER,
      GIT_CONFIG_KEY_2: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_2: 'git@github.com:',
      GIT_CONFIG_KEY_3: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_3: 'ssh://git@github.com/',
    });
  });

  it('references the token variable and never contains a token value', () => {
    const values = Object.values(gitCredentialEnv('https://github.com/o/r.git'));
    expect(values.join('\n')).toContain('${GH_TOKEN:-$GIT_TOKEN}');
    expect(values.join('\n')).not.toMatch(/ghp_|made-up/);
  });

  it('uses the lower-case host name without the port', () => {
    const env = gitCredentialEnv('https://GitHub.Example.com:8443/o/r.git');
    expect(env.GIT_CONFIG_KEY_0).toBe('credential.https://github.example.com.helper');
    expect(env.GIT_CONFIG_VALUE_2).toBe('git@github.example.com:');
    expect(env.GIT_CONFIG_VALUE_3).toBe('ssh://git@github.example.com/');
  });

  it('returns nothing for a local path (test hook)', () => {
    expect(gitCredentialEnv('/seed/repo')).toEqual({});
  });
});
