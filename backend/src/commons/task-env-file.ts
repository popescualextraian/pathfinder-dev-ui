import { readFileSync } from 'node:fs';

// TASK_ENV_FILE: `NAME=value` lines (comments, `export`, one pair of quotes and a trailing CR as in tools/compose.sh)
// whose variables go into every task container. Messages name the file and the line, never a value.
export function parseTaskEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('#')) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!m) throw new Error(`line ${i + 1} is not NAME=value`);
    env[m[1]] = m[2].replace(/^"(.*)"$|^'(.*)'$/, '$1$2');
  });
  return env;
}

export function readTaskEnvFile(path: string): Record<string, string> {
  try {
    return parseTaskEnv(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`TASK_ENV_FILE (${path}) cannot be used: ${error instanceof Error ? error.message : 'unreadable'}`, { cause: error });
  }
}

// The file wins over the engine's values, except the engine's AGENTIC_* (the task's own tokens, id, branch, prompt...).
// A file that sets GIT_CONFIG_COUNT brings its own GIT_CONFIG_* set, which replaces the engine's whole (numbered lists do not merge).
export function mergeTaskEnv(engine: Record<string, string>, file: Record<string, string>): Record<string, string> {
  const base = file.GIT_CONFIG_COUNT === undefined
    ? engine
    : Object.fromEntries(Object.entries(engine).filter(([k]) => !/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(k)));
  const own = Object.entries(engine).filter(([k]) => k.startsWith('AGENTIC_'));
  return { ...base, ...file, ...Object.fromEntries(own) };
}
