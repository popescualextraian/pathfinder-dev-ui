import { execFile } from 'node:child_process';
import { gitCredentialEnv } from '../../commons/git-credential-env';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const TOKEN_VARIABLES = ['GH_TOKEN', 'GIT_TOKEN'] as const;

export interface GitRunOptions {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

// A failed git call. The message names the subcommand only (never the arguments, which may hold a URL or path)
// plus git's redacted stderr.
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

// Removes the values of the token variables and any `//user[:pass]@` userinfo from a text.
export function redact(text: string, env: NodeJS.ProcessEnv): string {
  let out = text;
  for (const name of TOKEN_VARIABLES) {
    const value = env[name]?.trim();
    if (value) out = out.split(value).join('***');
  }
  return out.replace(/\/\/[^/@\s]*@/g, '//');
}

// The URL without userinfo (`https://u:p@host/x` -> `https://host/x`, `git:p@host:x` -> `git@host:x`); other forms unchanged.
export function withoutUserinfo(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.host && (parsed.username || parsed.password)) {
      parsed.username = '';
      parsed.password = '';
      return parsed.href;
    }
    if (parsed.host || parsed.protocol === 'file:') return url;
  } catch {
    // not a URL: a local path or scp-style
  }
  return url.replace(/^([^@/:]+):[^@/]*@/, '$1@');
}

// The only environment git gets: no global/system config, no prompts, the token variables (read by the credential
// helper's shell, never written into a value) and the helper config for the URL's host.
export function gitEnv(url: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {
    PATH: env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  for (const name of TOKEN_VARIABLES) if (env[name]) out[name] = env[name];
  return { ...out, ...gitCredentialEnv(url) };
}

// Runs git with an argument array (no shell) and resolves with its stdout. Exported as an object so tests can spy on it.
export const gitRunner = {
  run(args: string[], options: GitRunOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        {
          cwd: options.cwd,
          env: options.env,
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
          encoding: 'buffer',
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout);
            return;
          }
          const detail = stderr.toString('utf8').trim() || (error.killed ? 'timed out' : `exit code ${String(error.code)}`);
          reject(new GitError(redact(`git ${args[0] ?? ''} failed: ${detail}`, options.env)));
        },
      );
    });
  },
};
