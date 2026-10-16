import { isAbsolute } from 'node:path';

// Injection token of the validated engine configuration.
export const ENGINE_CONFIG = Symbol('ENGINE_CONFIG');

export interface EngineConfig {
  launcher: string;
  image: string;
  dockerNetwork: string;
  dataDir: string;
  repoUrl: string;
  project: string;
  maxRunning: number;
  claudeCodeOauthToken: string;
  ghToken: string;
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
  const image = required('ENGINE_IMAGE');
  const dockerNetwork = required('ENGINE_DOCKER_NETWORK');
  const dataDir = required('ENGINE_DATA_DIR');
  if (dataDir && !isAbsolute(dataDir)) problems.push('ENGINE_DATA_DIR must be an absolute path');
  const repoUrl = required('ENGINE_REPO_URL');
  const project = required('ENGINE_PROJECT');
  const claudeCodeOauthToken = required('CLAUDE_CODE_OAUTH_TOKEN');
  const ghToken = required('GH_TOKEN');

  let maxRunning = 2;
  const rawMax = value('ENGINE_MAX_RUNNING');
  if (rawMax !== undefined) {
    maxRunning = Number(rawMax);
    if (!/^\d+$/.test(rawMax) || !Number.isSafeInteger(maxRunning) || maxRunning < 1) {
      problems.push('ENGINE_MAX_RUNNING must be a positive integer');
      maxRunning = 2;
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
  const taskExtraBinds = parseJson('ENGINE_TASK_EXTRA_BINDS', value('ENGINE_TASK_EXTRA_BINDS'), [], problems, (parsed) =>
    Array.isArray(parsed) && parsed.every((v) => typeof v === 'string' && BIND.test(v))
      ? (parsed as string[])
      : undefined,
  );

  if (problems.length > 0) throw new EngineConfigError(problems);
  return { launcher, image, dockerNetwork, dataDir, repoUrl, project, maxRunning, claudeCodeOauthToken, ghToken, taskExtraEnv, taskExtraBinds };
}

const SHAPES: Record<string, string> = {
  ENGINE_TASK_EXTRA_ENV: 'a JSON object of strings',
  ENGINE_TASK_EXTRA_BINDS: 'a JSON array of "host:container[:mode]" strings',
};

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
