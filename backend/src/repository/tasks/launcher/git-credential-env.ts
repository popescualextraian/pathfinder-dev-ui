// Same git config the task image's git_cred_env (agentic-dev-base gitenv.sh) exports for a host:
// git sends ${GH_TOKEN:-$GIT_TOKEN} to https://HOST, and git@HOST: / ssh://git@HOST/ become https
// (no SSH keys exist in the container). The token is read by git's shell when the helper runs;
// only the variable reference is in the values, never the token.
const HELPER = '!f() { test "$1" = get && printf "username=x-access-token\\npassword=%s\\n" "${GH_TOKEN:-$GIT_TOKEN}"; }; f';

export function gitCredentialEnv(repoUrl: string): Record<string, string> {
  let host: string;
  try {
    host = new URL(repoUrl).hostname;
  } catch {
    return {}; // a local path (test hook): nothing to authenticate against
  }
  if (!host) return {};
  const key = `credential.https://${host}.helper`;
  const rewrite = `url.https://${host}/.insteadOf`;
  return {
    GIT_CONFIG_COUNT: '4',
    GIT_CONFIG_KEY_0: key,
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: key,
    GIT_CONFIG_VALUE_1: HELPER,
    GIT_CONFIG_KEY_2: rewrite,
    GIT_CONFIG_VALUE_2: `git@${host}:`,
    GIT_CONFIG_KEY_3: rewrite,
    GIT_CONFIG_VALUE_3: `ssh://git@${host}/`,
  };
}
