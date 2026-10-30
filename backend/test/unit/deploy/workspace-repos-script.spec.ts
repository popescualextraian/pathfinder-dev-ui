import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', '..', '..', '..', 'tools', 'workspace-repos.sh');

// tools/workspace-repos.sh against a local git repository holding .agentic/agentic.yaml.
describe('tools/workspace-repos.sh', () => {
  let dir: string;
  const git = (cwd: string, ...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, encoding: 'utf8' });

  const repoWith = (yaml?: string) => {
    const repo = join(dir, 'agentic-repo');
    mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'README.md'), 'x\n');
    if (yaml !== undefined) {
      mkdirSync(join(repo, '.agentic'));
      writeFileSync(join(repo, '.agentic', 'agentic.yaml'), yaml);
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'x');
    return `file://${repo}`;
  };
  const run = (repoUrl: string, extra = '') => {
    const env = join(dir, 'p.env');
    writeFileSync(env, `ENGINE_REPO_URL=${repoUrl}\nGH_TOKEN=made-up-token\n${extra}`);
    return spawnSync('bash', [SCRIPT, env], { encoding: 'utf8' });
  };

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wsrepos-test-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const yaml = `setup:
  - add plugin superpowers@x
  - add workspace https://git.example.invalid/g/app.git
  - volume m2 /home/dev/.m2
  - add workspace https://git.example.invalid/g/app-docs.git --name docs
  - add workspace /some/path
  - add workspace https://git.example.invalid/g/app.git
`;

  it('lists the https workspaces by the name the base image gives them', () => {
    const r = run(repoWith(yaml));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(
      'ENGINE_REPOS=[{"name":"app","url":"https://git.example.invalid/g/app.git"},{"name":"docs","url":"https://git.example.invalid/g/app-docs.git"}]',
    );
  });

  it('prints nothing when the env file sets ENGINE_REPOS, there are no workspace lines, or the repository cannot be read', () => {
    expect(run(repoWith(yaml), 'ENGINE_REPOS=[]\n').stdout).toBe('');
    rmSync(join(dir, 'agentic-repo'), { recursive: true, force: true });
    expect(run(repoWith('setup:\n  - add plugin x\n')).stdout).toBe('');
    rmSync(join(dir, 'agentic-repo'), { recursive: true, force: true });
    expect(run(repoWith()).stdout).toBe('');
    const gone = run(`file://${join(dir, 'missing')}`);
    expect(gone.status).toBe(0);
    expect(gone.stdout).toBe('');
    expect(gone.stderr).toContain('could not read');
    expect(gone.stderr).not.toContain('made-up-token');
  });
});
