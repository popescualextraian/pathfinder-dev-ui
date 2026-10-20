import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacklogConfigError, loadBacklogConfig, parseBacklogConfig } from '../../../../src/backlog/service/backlog-config';

const VALID = `
connector: gitlab
gitlab:
  baseUrl: https://gitlab.example.com
  project: group/project
  tokenEnv: GITLAB_TOKEN
lanes:
  - { id: todo, title: Todo, default: true, gitlab: { label: "status::todo" } }
  - { id: plan, title: Plan, trigger: plan.enter, gitlab: { label: "status::plan" } }
  - { id: in-progress, title: In progress, trigger: implement.enter, gitlab: { label: "status::in-progress" } }
  - { id: test, title: Test, trigger: test.enter, gitlab: { label: "status::test" } }
  - { id: review, title: Review, gitlab: { label: "status::review" } }
  - { id: done, title: Done, gitlab: { state: closed } }
`;
const ENV = { GITLAB_TOKEN: 'secret-token-value', BACKLOG_DATA_DIR: '/tmp/backlog' };

function problemsOf(yaml: string, env: NodeJS.ProcessEnv = ENV): { problems: string[]; message: string } {
  try {
    parseBacklogConfig(yaml, env);
  } catch (e) {
    expect(e).toBeInstanceOf(BacklogConfigError);
    return { problems: (e as BacklogConfigError).problems, message: (e as Error).message };
  }
  throw new Error('expected BacklogConfigError');
}

describe('parseBacklogConfig', () => {
  it('parses a valid config with defaults', () => {
    const c = parseBacklogConfig(VALID, ENV);
    expect(c.lanes.map((l) => l.id)).toEqual(['todo', 'plan', 'in-progress', 'test', 'review', 'done']);
    expect(c.lanes.filter((l) => l.default).map((l) => l.id)).toEqual(['todo']);
    expect(c.lanes[1].trigger).toBe('plan.enter');
    expect(c.gitlab).toEqual({ baseUrl: 'https://gitlab.example.com', project: 'group/project', token: 'secret-token-value' });
    expect(c.pollSeconds).toBe(60);
    expect(c.doneDays).toBe(14);
    expect(c.dataDir).toBe('/tmp/backlog');
  });

  it('reads pollSeconds and doneDays', () => {
    const c = parseBacklogConfig(`${VALID}pollSeconds: 5\ndoneDays: 3\n`, ENV);
    expect([c.pollSeconds, c.doneDays]).toEqual([5, 3]);
  });

  it('names a missing connector', () => {
    expect(problemsOf(VALID.replace('connector: gitlab', '')).problems.join()).toContain('connector');
  });

  it('rejects zero or two default lanes', () => {
    expect(problemsOf(VALID.replace('default: true, ', '')).problems.join()).toContain('default');
    expect(problemsOf(VALID.replace('id: plan,', 'id: plan, default: true,')).problems.join()).toContain('default');
  });

  it('rejects duplicate lane ids', () => {
    expect(problemsOf(VALID.replace('id: plan', 'id: todo')).problems.join()).toContain('lanes[1].id');
  });

  it('requires a gitlab mapping on every lane for the gitlab connector', () => {
    const { problems } = problemsOf(VALID.replace('gitlab: { label: "status::plan" }', ''));
    expect(problems.join()).toContain('lanes[1].gitlab');
  });

  it('requires the token variable and never prints the token', () => {
    const { problems } = problemsOf(VALID, { BACKLOG_DATA_DIR: '/tmp/b' });
    expect(problems.join()).toContain('gitlab.tokenEnv');
    const bad = problemsOf(VALID.replace('id: plan', 'id: todo'));
    expect(bad.message).not.toContain('secret-token-value');
  });

  it('requires BACKLOG_DATA_DIR', () => {
    expect(problemsOf(VALID, { GITLAB_TOKEN: 'x' }).problems.join()).toContain('BACKLOG_DATA_DIR');
  });
});

describe('loadBacklogConfig', () => {
  it('returns undefined when BACKLOG_CONFIG is unset', () => {
    expect(loadBacklogConfig({})).toBeUndefined();
  });

  it('reads the file named by BACKLOG_CONFIG', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'backlog-')), 'backlog.yaml');
    writeFileSync(file, VALID);
    expect(loadBacklogConfig({ ...ENV, BACKLOG_CONFIG: file })?.lanes).toHaveLength(6);
  });
});
