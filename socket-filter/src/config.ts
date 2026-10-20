import { isAbsolute, resolve } from 'node:path';

export interface FilterConfig {
  /** The only image task containers may run (= ENGINE_IMAGE). */
  image: string;
  /** The only network task containers may join (= ENGINE_DOCKER_NETWORK). */
  network: string;
  /** Unix socket the filter listens on. */
  listen: string;
  /** The real Docker socket. */
  upstream: string;
  namePrefix: string;
  labelPrefix: string;
  kindLabel: { key: string; value: string };
  debug: boolean;
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

// Messages name the variable but never print its value.
function fail(variable: string, why: string): never {
  throw new ConfigError(`docker-filter: invalid configuration: ${variable} ${why}`);
}

function required(env: Env, variable: string): string {
  const value = env[variable];
  if (value === undefined || value === '') fail(variable, 'is required');
  return value;
}

function absolutePath(env: Env, variable: string, fallback?: string): string {
  const value = env[variable] === undefined || env[variable] === '' ? fallback : env[variable];
  if (value === undefined) fail(variable, 'is required');
  if (!isAbsolute(value)) fail(variable, 'must be an absolute path');
  return value;
}

export function loadConfig(env: Env): FilterConfig {
  const image = required(env, 'FILTER_IMAGE');
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/:@]*$/.test(image)) fail('FILTER_IMAGE', 'is not an image reference');

  const network = required(env, 'FILTER_NETWORK');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(network) || ['host', 'none', 'default', 'bridge'].includes(network)) {
    fail('FILTER_NETWORK', 'must name a user-defined network');
  }

  const listen = absolutePath(env, 'FILTER_LISTEN');
  const upstream = absolutePath(env, 'FILTER_UPSTREAM', '/var/run/docker.sock');
  if (resolve(listen) === resolve(upstream)) fail('FILTER_UPSTREAM', 'must differ from FILTER_LISTEN');

  const namePrefix = env.FILTER_NAME_PREFIX ?? 'agentic-ui-task-';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(namePrefix)) fail('FILTER_NAME_PREFIX', 'must be a container name prefix');

  const labelPrefix = env.FILTER_LABEL_PREFIX ?? 'agentic-ui.';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(labelPrefix)) fail('FILTER_LABEL_PREFIX', 'must be a label key prefix');

  const kind = env.FILTER_KIND_LABEL ?? `${labelPrefix}kind=task`;
  const eq = kind.indexOf('=');
  const kindLabel = { key: kind.slice(0, eq), value: kind.slice(eq + 1) };
  if (
    eq < 0 ||
    kindLabel.value === '' ||
    !kindLabel.key.startsWith(labelPrefix) ||
    kindLabel.key === labelPrefix ||
    kindLabel.key === `${labelPrefix}task` ||
    !/^[A-Za-z0-9_.-]+$/.test(kindLabel.key) ||
    !/^[A-Za-z0-9_.-]+$/.test(kindLabel.value)
  ) {
    fail('FILTER_KIND_LABEL', 'must be <label prefix><key>=<value>');
  }

  return { image, network, listen, upstream, namePrefix, labelPrefix, kindLabel, debug: env.FILTER_DEBUG === '1' || env.FILTER_DEBUG === 'true' };
}
