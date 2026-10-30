import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOOLS = join(__dirname, '..', '..', '..', '..', 'tools');

// tools/destroy.sh with a docker stub: `ps` lists two task containers, every call is logged.
describe('tools/destroy.sh', () => {
  let dir: string;
  let log: string;
  const run = (envFile: string, ...args: string[]) =>
    spawnSync('bash', [join(dir, 'tools', 'destroy.sh'), envFile, ...args], {
      encoding: 'utf8',
      input: '',
      env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, STUB_LOG: log, HOME: join(dir, 'home') },
    });
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
  const writeEnv = (extra: string) => {
    const file = join(dir, 'drp.env');
    writeFileSync(file, `ENGINE_IMAGE=i\n${extra}`);
    return file;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'destroy-test-'));
    log = join(dir, 'docker.log');
    mkdirSync(join(dir, 'tools'));
    mkdirSync(join(dir, 'bin'));
    for (const f of ['destroy.sh', 'compose.sh']) {
      copyFileSync(join(TOOLS, f), join(dir, 'tools', f));
      chmodSync(join(dir, 'tools', f), 0o755);
    }
    writeFileSync(join(dir, 'bin', 'docker'), '#!/usr/bin/env bash\necho "$*" >> "$STUB_LOG"\n[ "$1" = ps ] && printf "agentic-ui-task-a\\nagentic-ui-task-b\\n"\nexit 0\n');
    chmodSync(join(dir, 'bin', 'docker'), 0o755);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('refuses the default UI (no COMPOSE_PROJECT_NAME) and touches nothing', () => {
    const r = run(writeEnv(''), '--yes');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('COMPOSE_PROJECT_NAME');
    expect(calls()).toBe('');
  });

  it('removes nothing without confirmation', () => {
    const r = run(writeEnv('COMPOSE_PROJECT_NAME=pathfinder-drp\n'));
    expect(r.status).not.toBe(0);
    expect(calls()).not.toContain('rm -f');
    expect(calls()).not.toContain('down');
  });

  it('removes the task containers on the project network and their volumes, then compose down -v', () => {
    const r = run(writeEnv('COMPOSE_PROJECT_NAME=pathfinder-drp\n'), '--yes');
    expect(r.status).toBe(0);
    const c = calls();
    expect(c).toContain('ps -a --filter network=pathfinder-drp --filter label=agentic-ui.kind=task');
    expect(c).toContain('rm -f agentic-ui-task-a');
    expect(c).toContain('volume rm agentic-ui-task-b');
    expect(c).toContain('down -v --remove-orphans');
  });
});
