import { dirname, isAbsolute, join } from 'node:path';

// Injection token of the validated architecture configuration.
export const ARCHITECTURE_CONFIG = Symbol('ARCHITECTURE_CONFIG');

export interface ArchitectureConfig {
  // ARCHITECTURE_DATA_DIR: where the architecture page keeps its data (default: `architecture` next to ENGINE_DATA_DIR).
  dataDir: string;
  // ARCHITECTURE_FETCH_SECONDS: minimum seconds between fetches (1..3600, default 60).
  fetchSeconds: number;
}

// Messages name variables only, never their values.
export class ArchitectureConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid architecture configuration: ${problems.join('; ')}`);
    this.name = 'ArchitectureConfigError';
  }
}

const MAX_FETCH_SECONDS = 3600;

const value = (env: NodeJS.ProcessEnv, name: string): string | undefined => env[name]?.trim() || undefined;

// ARCHITECTURE_ENABLED=1 switches the architecture page on.
export function architectureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return value(env, 'ARCHITECTURE_ENABLED') === '1';
}

export function loadArchitectureConfig(env: NodeJS.ProcessEnv = process.env): ArchitectureConfig {
  const problems: string[] = [];

  const enabled = value(env, 'ARCHITECTURE_ENABLED');
  if (enabled !== undefined && enabled !== '0' && enabled !== '1') problems.push('ARCHITECTURE_ENABLED must be 0 or 1');

  let dataDir = value(env, 'ARCHITECTURE_DATA_DIR');
  const engineDir = value(env, 'ENGINE_DATA_DIR');
  if (dataDir === undefined) {
    if (engineDir === undefined) problems.push('ARCHITECTURE_DATA_DIR is required when ENGINE_DATA_DIR is not set');
    else if (isAbsolute(engineDir)) dataDir = join(dirname(engineDir), 'architecture');
  } else if (!isAbsolute(dataDir)) {
    problems.push('ARCHITECTURE_DATA_DIR must be an absolute path');
  }

  let fetchSeconds = 60;
  const raw = value(env, 'ARCHITECTURE_FETCH_SECONDS');
  if (raw !== undefined) {
    if (!/^[1-9]\d*$/.test(raw)) problems.push('ARCHITECTURE_FETCH_SECONDS must be a positive integer');
    else if (Number(raw) > MAX_FETCH_SECONDS) problems.push(`ARCHITECTURE_FETCH_SECONDS must be at most ${MAX_FETCH_SECONDS}`);
    else fetchSeconds = Number(raw);
  }

  if (problems.length > 0) throw new ArchitectureConfigError(problems);
  return { dataDir: dataDir ?? '', fetchSeconds };
}
