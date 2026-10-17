import { isAbsolute } from 'node:path';
import { repoNameOf } from './repo-name';

// Injection token of the validated engine configuration.
export const ENGINE_CONFIG = Symbol('ENGINE_CONFIG');

export interface RepositoryEntry {
  name: string;
  url: string;
  default: boolean;
}

export interface EngineConfig {
  launcher: string;
  // Agent of the local launcher: the fake agent or the real Claude. Unused by other launchers.
  localAgent: 'fake' | 'claude';
  image: string;
  dockerNetwork: string;
  dataDir: string;
  repoUrl: string;
  // Hosts a task's repoUrl may point to: the host of repoUrl plus ENGINE_ALLOWED_REPO_HOSTS (lower case).
  allowedRepoHosts: string[];
  // ENGINE_REPO_URL (the default, first) and ENGINE_REPOS.
  repositories: RepositoryEntry[];
  project: string;
  maxRunning: number;
  // Seconds between two rounds of the task poller.
  pollSeconds: number;
  claudeCodeOauthToken: string;
  ghToken: string;
  // Commit author and committer identity of task containers.
  gitName: string;
  gitEmail: string;
  // Test hooks: extra environment variables and binds for task containers.
  taskExtraEnv: Record<string, string>;
  taskExtraBinds: string[];
}

// Messages name variables only, never their values: some of them are secrets.
export class EngineConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid engine configuration: ${problems.join('; ')}`);
    this.name = 'EngineConfigError';
  }
}

// Set by the engine itself; ENGINE_TASK_EXTRA_ENV must not replace them. (AGENTIC_REPO_URL and
// others stay allowed: the Docker tests use them.)
const MANAGED_ENV = new Set([
  'AGENTIC_TASK_TOKEN', 'AGENTIC_AGENT_TOKEN', 'AGENTIC_TASK_ID', 'AGENTIC_PROJECT', 'AGENTIC_TASK_DIR',
  'AGENTIC_REPO_REF', 'AGENTIC_PROMPT', 'AGENTIC_MODEL', 'AGENTIC_ALLOWED_ACTIONS', 'AGENTIC_WORKTREE',
  'AGENTIC_BRANCH', 'AGENTIC_BRIDGE_HOSTS', 'CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN',
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_CONFIG_COUNT',
]);
// GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n carry the push credential setup.
const MANAGED_ENV_PATTERN = /^GIT_CONFIG_(KEY|VALUE)_\d+$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined; // a local path (test hook)
  }
}

const BIND = /^[^:]+:[^:]+(:(ro|rw|z|Z|ro,z|ro,Z|rw,z|rw,Z))?$/;

export function loadEngineConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  const problems: string[] = [];
  const value = (name: string): string | undefined => env[name]?.trim() || undefined;
  const required = (name: string): string => {
    const v = value(name);
    if (v === undefined) problems.push(`${name} is required`);
    return v ?? '';
  };

  const launcher = value('ENGINE_LAUNCHER') ?? 'docker';
  // Only `local` has its own rules; docker and any unknown name (refused later by the launcher
  // factory) keep the Docker rules.
  const local = launcher === 'local';
  let localAgent: 'fake' | 'claude' = 'fake';
  if (local) {
    const rawAgent = value('ENGINE_LOCAL_AGENT') ?? 'fake';
    if (rawAgent === 'fake' || rawAgent === 'claude') localAgent = rawAgent;
    else problems.push('ENGINE_LOCAL_AGENT must be fake or claude');
  }
  const image = local ? (value('ENGINE_IMAGE') ?? '') : required('ENGINE_IMAGE');
  const dockerNetwork = local ? (value('ENGINE_DOCKER_NETWORK') ?? '') : required('ENGINE_DOCKER_NETWORK');
  const dataDir = required('ENGINE_DATA_DIR');
  if (dataDir && !isAbsolute(dataDir)) problems.push('ENGINE_DATA_DIR must be an absolute path');
  const repoUrl = required('ENGINE_REPO_URL');
  const parsedRepo = repoUrl ? parseUrl(repoUrl) : undefined;
  if (parsedRepo && (parsedRepo.username !== '' || parsedRepo.password !== '')) {
    problems.push('ENGINE_REPO_URL must not contain credentials');
  }
  const allowedRepoHosts: string[] = [];
  if (parsedRepo?.hostname) allowedRepoHosts.push(parsedRepo.hostname.toLowerCase());
  for (const host of (value('ENGINE_ALLOWED_REPO_HOSTS') ?? '').split(',')) {
    const h = host.trim().toLowerCase();
    if (h && !allowedRepoHosts.includes(h)) allowedRepoHosts.push(h);
  }
  const repositories: RepositoryEntry[] = [];
  if (repoUrl) repositories.push({ name: repoNameOf(repoUrl), url: repoUrl, default: true });
  const listed = parseJson('ENGINE_REPOS', value('ENGINE_REPOS'), [], problems, parseRepos);
  for (const entry of listed) {
    const same = repositories.find((r) => r.name === entry.name);
    if (same) {
      // The default listed again with the same URL is harmless; anything else clashes.
      if (same.url !== entry.url) problems.push('ENGINE_REPOS must not repeat a name (the default repository is named after its URL)');
      continue;
    }
    repositories.push({ ...entry, default: false });
    const host = new URL(entry.url).hostname.toLowerCase();
    if (!allowedRepoHosts.includes(host)) allowedRepoHosts.push(host);
  }
  const project = required('ENGINE_PROJECT');
  let claudeCodeOauthToken: string;
  let ghToken: string;
  let gitName: string;
  let gitEmail: string;
  if (local) {
    claudeCodeOauthToken = localAgent === 'claude' ? required('CLAUDE_CODE_OAUTH_TOKEN') : (value('CLAUDE_CODE_OAUTH_TOKEN') ?? '');
    ghToken = value('GH_TOKEN') ?? '';
    // Pushing needs an author identity: required as soon as a push token is configured.
    const identity = (name: string): string => {
      const v = value(name);
      if (v === undefined && ghToken) problems.push(`${name} is required when GH_TOKEN is set`);
      return v ?? '';
    };
    gitName = identity('ENGINE_GIT_NAME');
    gitEmail = identity('ENGINE_GIT_EMAIL');
  } else {
    claudeCodeOauthToken = required('CLAUDE_CODE_OAUTH_TOKEN');
    ghToken = required('GH_TOKEN');
    gitName = required('ENGINE_GIT_NAME');
    gitEmail = required('ENGINE_GIT_EMAIL');
  }

  let maxRunning = 2;
  const rawMax = value('ENGINE_MAX_RUNNING');
  if (rawMax !== undefined) {
    maxRunning = Number(rawMax);
    if (!/^\d+$/.test(rawMax) || !Number.isSafeInteger(maxRunning) || maxRunning < 1) {
      problems.push('ENGINE_MAX_RUNNING must be a positive integer');
      maxRunning = 2;
    }
  }

  let pollSeconds = 15;
  const rawPoll = value('ENGINE_POLL_SECONDS');
  if (rawPoll !== undefined) {
    pollSeconds = Number(rawPoll);
    if (!/^\d+$/.test(rawPoll) || !Number.isSafeInteger(pollSeconds) || pollSeconds < 1) {
      problems.push('ENGINE_POLL_SECONDS must be a positive integer');
      pollSeconds = 15;
    }
  }

  const taskExtraEnv = parseJson('ENGINE_TASK_EXTRA_ENV', value('ENGINE_TASK_EXTRA_ENV'), {}, problems, (parsed) =>
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.values(parsed).every((v) => typeof v === 'string')
      ? (parsed as Record<string, string>)
      : undefined,
  );
  for (const key of Object.keys(taskExtraEnv)) {
    if (!ENV_KEY.test(key)) problems.push('ENGINE_TASK_EXTRA_ENV has a key that is not a valid variable name');
    else if (MANAGED_ENV.has(key) || MANAGED_ENV_PATTERN.test(key)) problems.push(`ENGINE_TASK_EXTRA_ENV must not set ${key}; the engine manages it`);
  }
  const taskExtraBinds = parseJson('ENGINE_TASK_EXTRA_BINDS', value('ENGINE_TASK_EXTRA_BINDS'), [], problems, (parsed) =>
    Array.isArray(parsed) && parsed.every((v) => typeof v === 'string' && BIND.test(v))
      ? (parsed as string[])
      : undefined,
  );

  if (problems.length > 0) throw new EngineConfigError(problems);
  return { launcher, localAgent, image, dockerNetwork, dataDir, repoUrl, allowedRepoHosts, repositories, project, maxRunning, pollSeconds, claudeCodeOauthToken, ghToken, gitName, gitEmail, taskExtraEnv, taskExtraBinds };
}

const SHAPES: Record<string, string> = {
  ENGINE_REPOS: 'a JSON array of {"name", "url"} with unique names and https URLs without credentials',
  ENGINE_TASK_EXTRA_ENV: 'a JSON object of strings',
  ENGINE_TASK_EXTRA_BINDS: 'a JSON array of "host:container[:mode]" strings',
};

const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function parseRepos(parsed: unknown): { name: string; url: string }[] | undefined {
  if (!Array.isArray(parsed)) return undefined;
  const names = new Set<string>();
  const entries: { name: string; url: string }[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return undefined;
    const { name, url } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !REPO_NAME.test(name) || typeof url !== 'string' || names.has(name)) return undefined;
    const u = parseUrl(url);
    if (u?.protocol !== 'https:' || u.hostname === '' || u.username !== '' || u.password !== '') return undefined;
    names.add(name);
    entries.push({ name, url });
  }
  return entries;
}

function parseJson<T>(
  name: string,
  raw: string | undefined,
  fallback: T,
  problems: string[],
  check: (parsed: unknown) => T | undefined,
): T {
  if (raw === undefined) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    problems.push(`${name} must be ${SHAPES[name]}`);
    return fallback;
  }
  const checked = check(parsed);
  if (checked === undefined) {
    problems.push(`${name} must be ${SHAPES[name]}`);
    return fallback;
  }
  return checked;
}
