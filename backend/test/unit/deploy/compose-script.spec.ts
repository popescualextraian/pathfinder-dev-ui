import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const SECRET = 'made-up-secret-do-not-print';

// tools/compose.sh in a temp copy of the repo with a docker stub that logs its arguments and the variables compose would see.
describe('tools/compose.sh', () => {
  let dir: string;
  let log: string;
  let networkLabel: string | undefined; // undefined = no such network

  const writeEnv = (name: string, extra = '') => {
    const file = join(dir, 'projects', `${name}.env`);
    mkdirSync(join(dir, 'projects'), { recursive: true });
    writeFileSync(
      file,
      `COMPOSE_PROJECT_NAME=pathfinder-${name}\nENGINE_IMAGE=img:1\nENGINE_REPO_URL=https://git.example.invalid/grp/sub/${name}.git\nENGINE_PROJECT=${name}\nENGINE_GIT_NAME=A B\nENGINE_GIT_EMAIL=a@b.invalid\nGH_TOKEN=${SECRET}\nCLAUDE_CODE_OAUTH_TOKEN=${SECRET}\n${extra}`,
    );
    return file;
  };
  const run = (...args: string[]) =>
    spawnSync('bash', [join(dir, 'tools', 'compose.sh'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, HOME: join(dir, 'home'), PATH: `${join(dir, 'bin')}:${process.env.PATH}`, STUB_LOG: log, STUB_LABEL: networkLabel ?? '', STUB_NETWORK: networkLabel === undefined ? '' : '1' },
    });
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'compose-test-'));
    log = join(dir, 'docker.log');
    networkLabel = undefined;
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'tools'));
    for (const f of ['tools/compose.sh', 'tools/project-files.sh', 'tools/workspace-repos.sh', 'backlog.example.yaml']) {
      writeFileSync(join(dir, f), readFileSync(join(ROOT, f)));
      chmodSync(join(dir, f), 0o755);
    }
    mkdirSync(join(dir, 'workflows.example'));
    writeFileSync(join(dir, 'workflows.example', 'a.yaml'), 'x\n');
    writeFileSync(
      join(dir, 'bin', 'docker'),
      '#!/usr/bin/env bash\nif [ "$1 $2" = "network inspect" ]; then [ -n "$STUB_NETWORK" ] || exit 1; echo "$STUB_LABEL"; exit 0; fi\n' +
        'echo "$*|PEF=${PATHFINDER_ENV_FILE:-}|NET=${TASK_NETWORK:-}|EXT=${TASK_NETWORK_EXTERNAL:-}|ARCH=${ARCHITECTURE_ENABLED:-}|BL=${BACKLOG_CONFIG_FILE:-}|WF=${WORKFLOWS_DIR_HOST:-}" >> "$STUB_LOG"\n' +
        '[ -z "$ENGINE_REPOS" ] || echo "REPOS=$ENGINE_REPOS" >> "$STUB_LOG"\n',
    );
    chmodSync(join(dir, 'bin', 'docker'), 0o755);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('needs an env file and a compose command', () => {
    expect(run().stderr).toContain('usage');
    expect(run(join(dir, 'nope.env'), 'ps').stderr).toContain('env file');
    expect(calls()).toBe('');
  });

  it('names every missing setting on up, never a value', () => {
    const file = join(dir, 'projects', 'x.env');
    mkdirSync(join(dir, 'projects'));
    writeFileSync(file, `GH_TOKEN=${SECRET}\n`);
    const r = run(file, 'up', '-d');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('ENGINE_IMAGE');
    expect(r.stderr).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(r.stderr).not.toContain('GH_TOKEN');
    expect(r.stderr).not.toContain(SECRET);
    expect(run(file, 'ps').status).toBe(0); // only up checks
  });

  it('passes the env file both ways and a network named after the project; the architect page is on', () => {
    const file = writeEnv('drp');
    expect(run(file, 'ps').status).toBe(0);
    expect(calls()).toContain(`compose --env-file ${file} ps|PEF=${file}|NET=pathfinder-drp|EXT=|ARCH=1|`);
  });

  it('fills ENGINE_REPOS from the workspace lines of the repository on up, unless the file sets it', () => {
    const repo = join(dir, 'ws-repo');
    mkdirSync(join(repo, '.agentic'), { recursive: true });
    writeFileSync(join(repo, '.agentic', 'agentic.yaml'), 'setup:\n  - add workspace https://git.example.invalid/g/app.git\n');
    const g = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...a], { cwd: repo });
    g('init', '-q');
    g('add', '-A');
    g('commit', '-q', '-m', 'x');
    const file = join(dir, 'projects', 'ws.env');
    mkdirSync(join(dir, 'projects'), { recursive: true });
    const base = readFileSync(writeEnv('drp'), 'utf8').replace(/^ENGINE_REPO_URL=.*$/m, `ENGINE_REPO_URL=file://${repo}`);
    writeFileSync(file, base);
    expect(run(file, 'up', '-d').status).toBe(0);
    expect(calls()).toContain('REPOS=[{"name":"app","url":"https://git.example.invalid/g/app.git"}]');
    writeFileSync(log, '');
    writeFileSync(file, `${base}ENGINE_REPOS=[]\n`);
    expect(run(file, 'up', '-d').status).toBe(0);
    expect(calls()).not.toContain('REPOS=');
  });

  it('marks an existing network external when compose did not create it, not when it did', () => {
    networkLabel = '';
    expect(run(writeEnv('drp'), 'ps').status).toBe(0);
    expect(calls()).toContain('|EXT=true|');
    rmSync(log);
    networkLabel = 'pathfinder-drp';
    run(join(dir, 'projects', 'drp.env'), 'ps');
    expect(calls()).toContain('|EXT=|');
  });

  it('keeps TASK_NETWORK and ARCHITECTURE_ENABLED from the file', () => {
    run(writeEnv('drp', 'TASK_NETWORK=mine\nARCHITECTURE_ENABLED=0\n'), 'ps');
    expect(calls()).toContain('|NET=|EXT=|ARCH=|');
  });

  it('makes backlog.yaml and workflows under ~/.agentic/projects from the repository when GITLAB_TOKEN is set, once', () => {
    const file = writeEnv('drp', `GITLAB_TOKEN=${SECRET}\n`);
    const r = run(file, 'up', '-d');
    expect(r.status).toBe(0);
    const data = join(dir, 'home', '.agentic', 'projects', 'pathfinder-dev-ui', 'projects', 'drp');
    const yaml = readFileSync(join(data, 'backlog.yaml'), 'utf8');
    expect(yaml).toContain('baseUrl: https://git.example.invalid');
    expect(yaml).toContain('project: grp/sub/drp\n');
    expect(existsSync(join(data, 'workflows', 'a.yaml'))).toBe(true);
    expect(calls()).toContain(`|BL=${data}/backlog.yaml|WF=${data}/workflows\n`);
    expect(r.stdout + r.stderr + calls()).not.toContain(SECRET);
    writeFileSync(join(data, 'backlog.yaml'), 'edited\n');
    run(file, 'up', '-d');
    expect(readFileSync(join(data, 'backlog.yaml'), 'utf8')).toBe('edited\n');
  });

  it('uses the paths of the env file instead of the default folder', () => {
    const lanes = join(dir, 'mine', 'lanes.yaml');
    const flows = join(dir, 'mine', 'flows');
    run(writeEnv('drp', `GITLAB_TOKEN=${SECRET}\nBACKLOG_CONFIG_FILE=${lanes}\nWORKFLOWS_DIR_HOST=${flows}\n`), 'up', '-d');
    expect(existsSync(lanes)).toBe(true);
    expect(existsSync(join(flows, 'a.yaml'))).toBe(true);
    expect(calls()).toContain(`|BL=${lanes}|WF=${flows}\n`);
    expect(existsSync(join(dir, 'home', '.agentic'))).toBe(false);
  });

  it('switches the backlog off without GITLAB_TOKEN even when the file names the paths', () => {
    run(writeEnv('drp', 'BACKLOG_CONFIG_FILE=/x/lanes.yaml\nWORKFLOWS_DIR_HOST=/x/flows\n'), 'up', '-d');
    expect(calls()).toContain('|BL=|WF=\n');
    expect(existsSync(join(dir, 'home'))).toBe(false);
  });

  it('changes nothing without COMPOSE_PROJECT_NAME', () => {
    writeEnv('drp');
    const plain = join(dir, 'plain.env');
    writeFileSync(plain, readFileSync(join(dir, 'projects', 'drp.env'), 'utf8').replace(/^COMPOSE_PROJECT_NAME=.*\n/, ''));
    run(plain, 'ps');
    expect(calls()).toContain(`|NET=|EXT=|ARCH=|BL=|WF=\n`);
  });
});
