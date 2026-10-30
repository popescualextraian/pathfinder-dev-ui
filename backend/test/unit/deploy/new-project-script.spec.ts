import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPT = join(__dirname, '..', '..', '..', '..', 'tools', 'new-project.sh');

describe('tools/new-project.sh', () => {
  let dir: string;
  const run = (...args: string[]) =>
    spawnSync('bash', [join(dir, 'tools', 'new-project.sh'), ...args], { encoding: 'utf8', input: '', env: { ...process.env, HOME: dir, GIT_CONFIG_GLOBAL: join(dir, 'none') } });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'newproject-test-'));
    mkdirSync(join(dir, 'tools'));
    copyFileSync(SCRIPT, join(dir, 'tools', 'new-project.sh'));
    copyFileSync(join(dirname(SCRIPT), 'project-files.sh'), join(dir, 'tools', 'project-files.sh'));
    chmodSync(join(dir, 'tools', 'project-files.sh'), 0o755);
    copyFileSync(join(dirname(SCRIPT), '..', 'backlog.example.yaml'), join(dir, 'backlog.example.yaml'));
    mkdirSync(join(dir, 'workflows.example'));
    writeFileSync(join(dir, 'workflows.example', 'a.yaml'), 'x\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const file = (name: string) => join(dir, 'projects', `${name}.env`);

  it('writes a private env file with the project settings and empty tokens', () => {
    const r = run('drp', 'https://git.example.invalid/g/drp', 'A B', 'a@b.invalid');
    expect(r.status).toBe(0);
    const text = readFileSync(file('drp'), 'utf8');
    expect(text).toContain('COMPOSE_PROJECT_NAME=pathfinder-drp\n');
    expect(text).toContain('ENGINE_IMAGE=agentic-drp:local\n');
    expect(text).toContain('ENGINE_GIT_NAME=A B\n');
    expect(text).toMatch(/^GH_TOKEN=$/m);
    expect(text).toMatch(/^UI_PORT=\d+$/m);
    expect(statSync(file('drp')).mode & 0o777).toBe(0o600);
    expect(r.stdout).toContain('tools/deploy.sh projects/drp.env');
  });

  it('makes the lanes file and the workflows folder now and puts their paths in the env file', () => {
    expect(run('drp', 'https://git.example.invalid/g/sub/drp.git', 'A B', 'a@b.invalid').status).toBe(0);
    const data = join(dir, '.agentic', 'projects', 'pathfinder-dev-ui', 'projects', 'drp');
    expect(readFileSync(join(data, 'backlog.yaml'), 'utf8')).toContain('project: g/sub/drp\n');
    expect(existsSync(join(data, 'workflows', 'a.yaml'))).toBe(true);
    const text = readFileSync(file('drp'), 'utf8');
    expect(text).toContain(`BACKLOG_CONFIG_FILE=${data}/backlog.yaml\n`);
    expect(text).toContain(`WORKFLOWS_DIR_HOST=${data}/workflows\n`);
  });

  it('writes the network and Architect defaults', () => {
    expect(run('drp', 'https://git.example.invalid/g/drp-agentic', 'A B', 'a@b.invalid').status).toBe(0);
    const text = readFileSync(file('drp'), 'utf8');
    expect(text).toContain('TASK_NETWORK=agentic-drp\n');
    expect(text).toContain('TASK_NETWORK_EXTERNAL=true\n');
    expect(text).toContain('ARCHITECTURE_ENABLED=0\n');
  });

  it('takes the GitLab project of the backlog from the repository without -agentic, or from the fifth argument', () => {
    const lanes = (n: string) => readFileSync(join(dir, '.agentic', 'projects', 'pathfinder-dev-ui', 'projects', n, 'backlog.yaml'), 'utf8');
    expect(run('drp', 'https://git.example.invalid/g/drp-agentic.git', 'A B', 'a@b.invalid').status).toBe(0);
    expect(readFileSync(file('drp'), 'utf8')).toContain('GITLAB_PROJECT_URL=https://git.example.invalid/g/drp\n');
    expect(lanes('drp')).toContain('project: g/drp\n');
    expect(run('other', 'https://git.example.invalid/g/o-agentic', 'A B', 'a@b.invalid', 'https://git.example.invalid/board/o').status).toBe(0);
    expect(lanes('other')).toContain('project: board/o\n');
    expect(run('bad', 'https://git.example.invalid/g/b', 'A B', 'a@b.invalid', 'http://x.invalid/g/b').status).not.toBe(0);
  });

  describe('an existing lanes file', () => {
    const data = () => join(dir, '.agentic', 'projects', 'pathfinder-dev-ui', 'projects', 'drp');
    const args = ['drp', 'https://git.example.invalid/g/new', 'A', 'a@b.invalid'];
    const runWith = (choice?: string) =>
      spawnSync('bash', [join(dir, 'tools', 'new-project.sh'), ...args], {
        encoding: 'utf8', input: '',
        env: { ...process.env, HOME: dir, GIT_CONFIG_GLOBAL: join(dir, 'none'), ...(choice ? { NEW_PROJECT_EXISTING: choice } : {}) },
      });
    beforeEach(() => {
      mkdirSync(data(), { recursive: true });
      writeFileSync(join(data(), 'backlog.yaml'), '  project: g/old\n');
    });

    it('backup keeps a copy and writes a new file for the new repository', () => {
      const r = runWith('backup');
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('g/old');
      expect(readFileSync(join(data(), 'backlog.yaml'), 'utf8')).toContain('project: g/new\n');
      const copy = readdirSync(data()).find((f) => f.startsWith('backlog.yaml.bak-'));
      expect(readFileSync(join(data(), copy as string), 'utf8')).toContain('g/old');
    });

    it('also covers an existing env file and workflows folder', () => {
      expect(run(...args).status).not.toBe(0);
      expect(runWith('backup').status).toBe(0);
      mkdirSync(join(data(), 'workflows'), { recursive: true });
      writeFileSync(join(data(), 'workflows', 'mine.yaml'), 'mine\n');
      expect(runWith('backup').status).toBe(0);
      expect(readdirSync(dirname(file('drp'))).some((f) => f.startsWith('drp.env.bak-'))).toBe(true);
      expect(existsSync(join(data(), 'workflows', 'mine.yaml'))).toBe(false);
      expect(readdirSync(data()).some((f) => f.startsWith('workflows.bak-'))).toBe(true);
    });

    it('overwrite replaces it without a copy', () => {
      expect(runWith('overwrite').status).toBe(0);
      expect(readFileSync(join(data(), 'backlog.yaml'), 'utf8')).toContain('project: g/new\n');
      expect(readdirSync(data()).some((f) => f.includes('.bak-'))).toBe(false);
    });

    it('stops without a terminal or on another answer and changes nothing', () => {
      expect(runWith().status).not.toBe(0);
      expect(runWith('x').status).not.toBe(0);
      expect(readFileSync(join(data(), 'backlog.yaml'), 'utf8')).toBe('  project: g/old\n');
    });
  });

  it('gives the next project another port and never overwrites', () => {
    run('a', 'https://git.example.invalid/g/a', 'A', 'a@b.invalid');
    run('b', 'https://git.example.invalid/g/b', 'A', 'a@b.invalid');
    const port = (n: string) => /UI_PORT=(\d+)/.exec(readFileSync(file(n), 'utf8'))?.[1];
    expect(port('a')).not.toBe(port('b'));
    const again = run('a', 'https://git.example.invalid/g/a', 'A', 'a@b.invalid');
    expect(again.status).not.toBe(0);
    expect(again.stderr).toContain('exists');
    expect(readFileSync(file('a'), 'utf8')).toContain('g/a');
  });

  it('refuses a bad name or a repository with credentials, and a missing value without a terminal', () => {
    expect(run('Bad Name', 'https://h.invalid/g/r', 'A', 'a@b.invalid').status).not.toBe(0);
    expect(run('ok', 'https://user:pw@h.invalid/g/r', 'A', 'a@b.invalid').status).not.toBe(0);
    expect(run('ok', 'http://h.invalid/g/r', 'A', 'a@b.invalid').status).not.toBe(0);
    const r = run('ok');
    expect(r.status).not.toBe(0);
    expect(existsSync(file('ok'))).toBe(false);
  });
});
