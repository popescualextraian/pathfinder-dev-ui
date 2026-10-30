import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPT = join(__dirname, '..', '..', '..', '..', 'tools', 'deploy.sh');
const SECRET = 'made-up-secret-do-not-print';

// tools/deploy.sh runs in a temp clone (origin = a bare repo) with a docker stub first on PATH.
describe('tools/deploy.sh', () => {
  let dir: string;
  let repo: string;
  let envFile: string;
  let dockerLog: string;
  let inspectFails: boolean;

  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };

  let extraEnv: Record<string, string>;
  const run = (...args: string[]): SpawnSyncReturns<string> =>
    spawnSync('bash', [join(repo, 'tools', 'deploy.sh'), ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATHFINDER_CA_DIR: '',
        HOME: join(dir, 'home'),
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        STUB_LOG: dockerLog,
        STUB_INSPECT_FAILS: inspectFails ? '1' : '',
        ...extraEnv,
      },
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'deploy-test-'));
    inspectFails = false;
    extraEnv = {};
    mkdirSync(join(dir, 'home'));
    dockerLog = join(dir, 'docker.log');
    mkdirSync(join(dir, 'bin'));
    writeFileSync(
      join(dir, 'bin', 'docker'),
      '#!/usr/bin/env bash\necho "$*|PEF=${PATHFINDER_ENV_FILE:-}|CA=${PATHFINDER_CA_CONTEXT:-}" >> "$STUB_LOG"\n[ "$1 $2" = "image inspect" ] && [ -n "$STUB_INSPECT_FAILS" ] && exit 1\nexit 0\n',
    );
    chmodSync(join(dir, 'bin', 'docker'), 0o755);
    const origin = join(dir, 'origin.git');
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
    repo = join(dir, 'repo');
    git(dir, 'clone', '-q', origin, repo);
    git(repo, 'checkout', '-q', '-b', 'main');
    mkdirSync(join(repo, 'tools'));
    copyFileSync(SCRIPT, join(repo, 'tools', 'deploy.sh'));
    copyFileSync(join(dirname(SCRIPT), 'compose.sh'), join(repo, 'tools', 'compose.sh'));
    writeFileSync(join(repo, 'file.txt'), 'x\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'push', '-q', '-u', 'origin', 'main');
    envFile = join(dir, 'prod.env');
    writeFileSync(envFile, `GH_TOKEN=${SECRET}\nCLAUDE_CODE_OAUTH_TOKEN=${SECRET}\nENGINE_IMAGE="task-image:1"\nENGINE_REPO_URL=https://h.invalid/g/r\nENGINE_PROJECT=p\nENGINE_GIT_NAME=A\nENGINE_GIT_EMAIL=a@b.invalid\nUI_PORT=3456\n`);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const dockerCalls = () => (existsSync(dockerLog) ? readFileSync(dockerLog, 'utf8') : '');

  it('refuses without an argument or with a missing env file', () => {
    expect(run().status).not.toBe(0);
    expect(run().stderr).toContain('usage');
    const r = run(join(dir, 'nope.env'));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('env file');
    expect(dockerCalls()).toBe('');
  });

  it('does not mind local changes or another branch, and never pulls', () => {
    writeFileSync(join(repo, 'file.txt'), 'changed\n');
    git(repo, 'checkout', '-q', '-b', 'feature');
    const r = run(envFile);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('Already up to date');
  });

  it('stops with a hint when the task image is missing, before compose', () => {
    inspectFails = true;
    const r = run(envFile);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('agentic build');
    expect(dockerCalls()).not.toContain('compose');
  });

  it('checks the image, runs compose with the env file, prints the URL and never the env file', () => {
    const r = run(envFile);
    expect(r.status).toBe(0);
    const calls = dockerCalls();
    expect(calls).toContain('image inspect task-image:1');
    expect(calls).toContain(`compose --env-file ${envFile} up -d --build --wait|PEF=${envFile}`);
    expect(r.stdout).toContain('http://127.0.0.1:3456');
    expect(r.stdout + r.stderr + calls).not.toContain(SECRET);
  });

  describe('the proxy CA folder (trusted at image build, certificates never from the repository)', () => {
    const caDir = () => join(dir, 'ca');
    const withCerts = (path: string) => {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'proxy-root.crt'), 'made-up certificate\n');
    };

    it('passes nothing when there is no folder: the build is unchanged', () => {
      const r = run(envFile);
      expect(r.status).toBe(0);
      expect(dockerCalls()).toContain('|CA=\n');
    });

    it('passes PATHFINDER_CA_DIR as the build context when it holds a .crt', () => {
      withCerts(caDir());
      extraEnv = { PATHFINDER_CA_DIR: caDir() };
      const r = run(envFile);
      expect(r.status).toBe(0);
      expect(dockerCalls()).toContain(`|CA=${caDir()}\n`);
      expect(r.stdout).toContain(caDir());
    });

    it('defaults to ~/.agentic/ca when that folder has a .crt', () => {
      const home = join(dir, 'home', '.agentic', 'ca');
      withCerts(home);
      const r = run(envFile);
      expect(r.status).toBe(0);
      expect(dockerCalls()).toContain(`|CA=${home}\n`);
    });

    it('ignores a default folder without a .crt', () => {
      mkdirSync(join(dir, 'home', '.agentic', 'ca'), { recursive: true });
      writeFileSync(join(dir, 'home', '.agentic', 'ca', 'notes.txt'), 'x');
      run(envFile);
      expect(dockerCalls()).toContain('|CA=\n');
    });

    it('refuses an explicit PATHFINDER_CA_DIR that is not a folder with a .crt, before compose', () => {
      extraEnv = { PATHFINDER_CA_DIR: join(dir, 'missing') };
      const r = run(envFile);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('PATHFINDER_CA_DIR');
      expect(dockerCalls()).not.toContain('compose');
    });
  });
});
