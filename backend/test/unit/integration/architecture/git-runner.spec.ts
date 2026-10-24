import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitError, gitEnv, gitRunner, redact, withoutUserinfo } from '../../../../src/integration/architecture/git-runner';

describe('git-runner', () => {
  const env = { PATH: process.env.PATH, GH_TOKEN: 'ghp_made-up-token', GIT_TOKEN: 'glpat-made-up' };

  it('redacts the token values and userinfo from text', () => {
    const text = 'fatal: https://u:p@example.invalid/a.git said ghp_made-up-token and glpat-made-up; //x@host/y';
    const out = redact(text, env);
    expect(out).not.toContain('ghp_made-up-token');
    expect(out).not.toContain('glpat-made-up');
    expect(out).not.toContain('u:p@');
    expect(out).not.toContain('x@host');
    expect(out).toContain('https://example.invalid/a.git');
  });

  it('ignores empty token variables', () => {
    expect(redact('abc', { GH_TOKEN: '', GIT_TOKEN: '  ' })).toBe('abc');
  });

  it('strips userinfo from URLs and leaves other forms', () => {
    expect(withoutUserinfo('https://user:pw@example.invalid/a/b.git')).toBe('https://example.invalid/a/b.git');
    expect(withoutUserinfo('https://ghp_x@github.com/a/b.git')).toBe('https://github.com/a/b.git');
    expect(withoutUserinfo('https://github.com/a/b.git')).toBe('https://github.com/a/b.git');
    expect(withoutUserinfo('/tmp/repo.git')).toBe('/tmp/repo.git');
    expect(withoutUserinfo('file:///tmp/repo.git')).toBe('file:///tmp/repo.git');
    expect(withoutUserinfo('git@github.com:a/b.git')).toBe('git@github.com:a/b.git');
    expect(withoutUserinfo('git:secret@github.com:a/b.git')).toBe('git@github.com:a/b.git');
  });

  it('builds a minimal env with the credential helper and no token value in config values', () => {
    const e = gitEnv('https://github.com/a/b.git', { ...env, HOME: '/home/x', OTHER: 'y' });
    expect(e).toMatchObject({ LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
    expect(e.GH_TOKEN).toBe('ghp_made-up-token');
    expect(e.GIT_TOKEN).toBe('glpat-made-up');
    expect(e.OTHER).toBeUndefined();
    expect(e.HOME).toBeUndefined();
    expect(e.GIT_CONFIG_KEY_1).toBe('credential.https://github.com.helper');
    const configValues = Object.entries(e).filter(([k]) => k.startsWith('GIT_CONFIG_VALUE'));
    expect(JSON.stringify(configValues)).not.toContain('ghp_made-up-token');
  });

  it('runs git with an argument array and returns stdout', async () => {
    const out = await gitRunner.run(['--version'], { env: gitEnv('/x', env) });
    expect(out.toString('utf8')).toMatch(/^git version/);
  });

  it('rejects with a redacted GitError naming only the subcommand', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-runner-'));
    try {
      const err = await gitRunner
        .run(['clone', '--', 'https://u:ghp_made-up-token@127.0.0.1:1/nothing.git', join(dir, 'x')], {
          cwd: dir,
          env: gitEnv('https://127.0.0.1:1/nothing.git', env),
          timeoutMs: 10_000,
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GitError);
      const message = (err as Error).message;
      expect(message).toMatch(/^git clone failed/);
      expect(message).not.toContain('ghp_made-up-token');
      expect(message).not.toContain('u:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
