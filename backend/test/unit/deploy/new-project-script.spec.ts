import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  it('gives the next project another port and never overwrites', () => {
    run('a', 'https://git.example.invalid/g/a', 'A', 'a@b.invalid');
    run('b', 'https://git.example.invalid/g/b', 'A', 'a@b.invalid');
    const port = (n: string) => /UI_PORT=(\d+)/.exec(readFileSync(file(n), 'utf8'))?.[1];
    expect(port('a')).not.toBe(port('b'));
    const again = run('a', 'https://git.example.invalid/g/a', 'A', 'a@b.invalid');
    expect(again.status).not.toBe(0);
    expect(again.stderr).toContain('exists');
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
