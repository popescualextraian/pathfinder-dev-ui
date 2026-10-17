import { sectionOf, titleFrom, toView } from '../../../../src/service/tasks/task-view';
import { AGENT_TOKEN, TASK_TOKEN, record } from './helpers';

describe('sectionOf', () => {
  it.each([
    ['starting', false, 'working'],
    ['running', false, 'working'],
    ['waiting', false, 'needs-you'],
    ['failed', false, 'needs-you'],
    ['interrupted', false, 'needs-you'],
    ['idle', false, 'in-review'],
    ['suspended', false, 'in-review'],
    ['stopped', false, 'done'],
    ['idle', true, 'done'],
    ['waiting', true, 'done'],
    ['running', true, 'done'],
  ])('state %s, closed %s -> %s', (state, closed, section) => {
    expect(sectionOf(state, closed)).toBe(section);
  });

  it('puts an unknown state under working', () => {
    expect(sectionOf('something-new', false)).toBe('working');
  });
});

describe('titleFrom', () => {
  it('takes the first non-blank line, with whitespace collapsed', () => {
    expect(titleFrom('\n  Fix   the\tbug \nmore')).toBe('Fix the bug');
  });
  it('shortens to 80 characters with an ellipsis', () => {
    const title = titleFrom('a'.repeat(200));
    expect(title).toHaveLength(80);
    expect(title.endsWith('…')).toBe(true);
    expect(titleFrom('a'.repeat(80))).toBe('a'.repeat(80));
  });
  it('prefers a given title unless it is blank', () => {
    expect(titleFrom('prompt', ' Given ')).toBe('Given');
    expect(titleFrom('prompt', '  ')).toBe('prompt');
  });
});

describe('toView', () => {
  it('has every field of the contract and no token', () => {
    const view = toView(record({
      title: 'T', repository: 'r', model: 'm', repoRef: 'main', lastState: 'waiting',
      lastMessage: 'full text', lastMessageAt: '2026-01-01T01:00:00.000Z',
      lastStatus: { reason: 'question Q1', summary: 'S', questions: [{ id: 'Q1' }] },
    }));
    expect(view).toEqual({
      id: 'T-20260101-abcd', title: 'T', prompt: 'do it', repository: 'r', repoUrl: 'https://github.com/acme/default.git',
      repoRef: 'main', model: 'm', branch: 'agentic/T-20260101-abcd', state: 'waiting', reason: 'question Q1',
      section: 'needs-you', questions: [{ id: 'Q1' }], lastMessage: 'full text', lastMessageAt: '2026-01-01T01:00:00.000Z',
      summary: 'S', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', closed: false,
    });
    expect(JSON.stringify(view)).not.toContain(TASK_TOKEN);
    expect(JSON.stringify(view)).not.toContain(AGENT_TOKEN);
  });

  it('derives title and repository for an older record, which counts as not closed', () => {
    const view = toView(record({ prompt: 'Old task\nbody', repoUrl: 'https://github.com/acme/legacy.git' }));
    expect(view).toMatchObject({ title: 'Old task', repository: 'legacy', closed: false, section: 'in-review' });
    expect(view).not.toHaveProperty('closedAt');
    expect(view).not.toHaveProperty('lastMessage');
  });

  it('a closed task is stopped, done and has no open questions', () => {
    const view = toView(record({ closed: true, closedAt: '2026-01-02T00:00:00.000Z', lastState: 'stopped', lastStatus: { questions: [{ id: 'Q1' }] } }));
    expect(view).toMatchObject({ closed: true, closedAt: '2026-01-02T00:00:00.000Z', state: 'stopped', section: 'done', questions: [] });
  });

  it('section follows the live state', () => {
    expect(toView(record({ lastState: 'idle' }), { state: 'running' }).section).toBe('working');
  });
});
