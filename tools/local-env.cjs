'use strict';
// Environment of the app that tools/start-local.mjs runs (importable, unit-tested).

// A URL (scheme://...) or an scp-like SSH address (user@host:path); anything else is a local path.
function isRepoUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^[^/\s]+@[^/\s]+:/.test(value);
}

// The repository location with any userinfo removed, safe to print.
function redactRepoUrl(value) {
  return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, '$1');
}

// Defaults, then the caller's environment, then the fixed launcher settings. With the fake agent
// (whose SHELL: prompt runs commands as the app's user and can read the app's environment) the
// app does not get CLAUDE_CODE_OAUTH_TOKEN, nor GH_TOKEN when the repository is a local path.
// BACKLOG_CONFIG, BACKLOG_DATA_DIR and the backlog token variable (GITLAB_TOKEN, or whatever gitlab.tokenEnv
// names) pass through unchanged: the backlog is off unless BACKLOG_CONFIG is set.
function buildAppEnv({ processEnv, root, projectName, port, dataDir }) {
  const given = Object.fromEntries(Object.entries(processEnv).filter(([, v]) => v !== undefined && v !== ''));
  const env = {
    ENGINE_REPO_URL: root,
    ENGINE_PROJECT: projectName,
    ENGINE_LOCAL_AGENT: 'fake',
    ENGINE_GIT_NAME: 'Local Dev',
    ENGINE_GIT_EMAIL: 'local-dev@example.invalid',
    ...given,
    ENGINE_LAUNCHER: 'local',
    PORT: port,
    ENGINE_DATA_DIR: dataDir,
  };
  if (env.ENGINE_LOCAL_AGENT === 'fake') {
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    if (!isRepoUrl(env.ENGINE_REPO_URL)) delete env.GH_TOKEN;
  }
  return env;
}

module.exports = { buildAppEnv, isRepoUrl, redactRepoUrl };
