import { sectionOf, summaryLineOf, titleFrom, toView } from '../../../../src/engine/service/task-view';
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
      section: 'needs-you', questions: [{ id: 'Q1', session: 'main' }], lastMessage: 'full text', lastMessageAt: '2026-01-01T01:00:00.000Z',
      summary: 'S', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', closed: false,
      sessions: [{
        name: 'main', model: 'm', state: 'waiting', reason: 'question Q1', createdAt: '2026-01-01T00:00:00.000Z',
        lastMessage: 'full text', lastMessageAt: '2026-01-01T01:00:00.000Z', questions: 1,
      }],
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

  it('lists the app names of the record (its published app ports), none without them', () => {
    expect(toView(record({ appPorts: { web: { '3000': 49153 }, api: {} } })).appNames).toEqual(['web', 'api']);
    expect(toView(record({}))).not.toHaveProperty('appNames');
    expect(toView(record({ appPorts: {} }))).not.toHaveProperty('appNames');
  });

  it('section follows the live state', () => {
    expect(toView(record({ lastState: 'idle' }), { state: 'running' }).section).toBe('working');
  });
});

describe('toView schedule', () => {
  it('carries scheduleId and scheduleTitle, and summaryLine only when not empty; never the run timeout', () => {
    const view = toView(record({ scheduled: { runTimeoutSeconds: 600 }, scheduleId: 'nightly', scheduleTitle: 'Nightly', summaryLine: 'Did it', lastState: 'stopped' }));
    expect(view).toMatchObject({ scheduleId: 'nightly', scheduleTitle: 'Nightly', summaryLine: 'Did it' });
    expect(view).not.toHaveProperty('scheduled');
    expect(toView(record({ scheduleId: 'nightly', summaryLine: '' }))).not.toHaveProperty('summaryLine');
  });
});

describe('summaryLineOf', () => {
  it('is the first non-blank line, trimmed, at most 200 characters', () => {
    expect(summaryLineOf('\n  \n  First line  \nsecond')).toBe('First line');
    expect(summaryLineOf('x'.repeat(300))).toHaveLength(200);
    expect(summaryLineOf('x'.repeat(300)).endsWith('…')).toBe(true);
    expect(summaryLineOf('\n \n')).toBe('');
  });
});

describe('toView kind', () => {
  it('carries the kind and omits it when absent', () => {
    expect(toView(record({ kind: 'workflow-generator' })).kind).toBe('workflow-generator');
    expect('kind' in toView(record())).toBe(false);
  });
});

describe('toView sessions', () => {
  it('shows an older record as one main session built from the record', () => {
    const view = toView(record({ model: 'm', lastState: 'idle', lastMessage: 'hi', lastMessageAt: '2026-01-01T01:00:00.000Z' }));
    expect(view.sessions).toEqual([{
      name: 'main', model: 'm', state: 'idle', createdAt: '2026-01-01T00:00:00.000Z', lastMessage: 'hi',
      lastMessageAt: '2026-01-01T01:00:00.000Z', questions: 0,
    }]);
  });

  it('lists recorded sessions with their questions counted, and keeps the task-level message', () => {
    const view = toView(record({
      lastState: 'waiting', lastMessage: 'newest', lastMessageAt: '2026-01-01T02:00:00.000Z',
      sessions: [
        { name: 'main', state: 'idle', createdAt: '2026-01-01T00:00:00.000Z', lastMessage: 'a', lastMessageAt: '2026-01-01T01:00:00.000Z' },
        { name: 'impl', state: 'waiting', createdAt: '2026-01-01T00:05:00.000Z', forkOf: 'main', model: 'x', lastMessage: 'newest', lastMessageAt: '2026-01-01T02:00:00.000Z' },
      ],
      lastStatus: { questions: [{ id: 'Q1', session: 'impl' }, { id: 'Q2' }] },
    }));
    expect(view.sessions.map((s) => [s.name, s.questions, s.forkOf])).toEqual([['main', 1, undefined], ['impl', 1, 'main']]);
    expect(view.questions.map((q) => q.session)).toEqual(['impl', 'main']);
    expect(view.lastMessage).toBe('newest');
    expect(view.section).toBe('needs-you');
  });

  it('a question in one session puts the task under needs-you although another session runs; task state stays running', () => {
    const view = toView(record({
      lastState: 'running',
      sessions: [
        { name: 'main', state: 'running', createdAt: '2026-01-01T00:00:00.000Z' },
        { name: 'impl', state: 'waiting', createdAt: '2026-01-01T00:05:00.000Z' },
      ],
      lastStatus: { questions: [{ id: 'Q1', session: 'impl' }] },
    }));
    expect(view.state).toBe('running');
    expect(view.section).toBe('needs-you');
    expect(view.sessions.map((s) => s.state)).toEqual(['running', 'waiting']);
  });

  it('a stopped task shows no running or waiting session', () => {
    const view = toView(record({
      lastState: 'stopped',
      sessions: [
        { name: 'main', state: 'running', createdAt: '2026-01-01T00:00:00.000Z' },
        { name: 'impl', state: 'waiting', createdAt: '2026-01-01T00:05:00.000Z' },
        { name: 'old', state: 'idle', createdAt: '2026-01-01T00:06:00.000Z' },
      ],
    }));
    expect(view.sessions.map((s) => s.state)).toEqual(['stopped', 'stopped', 'idle']);
  });
});
