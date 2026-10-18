import { summarizeLedger } from '../../../../../src/engine/service/cost/task-cost';

const READ = '2026-01-02T00:00:00.000Z';
const TASK = 'T-1';

function rec(over: Record<string, unknown> = {}, totals: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 'cost-record/v1', ts: '2026-01-01T10:00:00Z', project: 'p', harness: 'claude', session: 's1',
    context: { kind: 'task', task: TASK }, models: [],
    totals: { input: 100, output: 50, cache_read: 10, cache_write: 5, cost: { estimate: 1.5 }, ...totals },
    ...over,
  });
}

describe('summarizeLedger', () => {
  it('returns undefined for empty input and for input without a valid line', () => {
    expect(summarizeLedger('', TASK, READ)).toBeUndefined();
    expect(summarizeLedger('\n\n', TASK, READ)).toBeUndefined();
    expect(summarizeLedger('not json\n{"a":1}\n', TASK, READ)).toBeUndefined();
  });

  it('maps one record', () => {
    expect(summarizeLedger(rec(), TASK, READ)).toEqual({
      input: 100, output: 50, cacheRead: 10, cacheWrite: 5, usd: { estimate: 1.5 }, sessions: 1, snapshotAt: '2026-01-01T10:00:00Z', readAt: READ,
    });
  });

  it('sums sessions and takes the latest timestamp', () => {
    const text = [rec(), rec({ session: 's2', ts: '2026-01-01T12:00:00Z' }, { input: 1, output: 2, cache_read: 3, cache_write: 4, cost: { estimate: 0.25 } })].join('\n');
    expect(summarizeLedger(text, TASK, READ)).toMatchObject({
      input: 101, output: 52, cacheRead: 13, cacheWrite: 9, usd: { estimate: 1.75 }, sessions: 2, snapshotAt: '2026-01-01T12:00:00Z',
    });
  });

  it('a later snapshot of a session replaces the earlier one; same session id of another harness is separate', () => {
    const text = [
      rec({ ts: '2026-01-01T10:00:00Z' }, { input: 10 }),
      rec({ harness: 'copilot' }, { input: 7 }),
      rec({ ts: '2026-01-01T11:00:00Z' }, { input: 40 }),
    ].join('\n');
    expect(summarizeLedger(text, TASK, READ)).toMatchObject({ input: 47, sessions: 2, snapshotAt: '2026-01-01T11:00:00Z' });
  });

  it("ignores another task's lines", () => {
    const text = [rec({ context: { kind: 'task', task: 'T-2' } }), rec({ context: { kind: 'dev' } })].join('\n');
    expect(summarizeLedger(text, TASK, READ)).toBeUndefined();
    expect(summarizeLedger(`${text}\n${rec({ session: 'mine' }, { input: 3 })}`, TASK, READ)).toMatchObject({ input: 3, sessions: 1 });
  });

  it.each([
    ['wrong schema', { schema: 'cost-record/v2' }, {}],
    ['bad ts', { ts: '2026-01-01 10:00' }, {}],
    ['bad harness', { harness: 'Claude' }, {}],
    ['empty session', { session: '' }, {}],
    ['bad kind', { context: { kind: 'x', task: TASK } }, {}],
    ['negative tokens', {}, { input: -1 }],
    ['fractional tokens', {}, { output: 1.5 }],
    ['unknown source', {}, { cost: { other: 1 } }],
    ['negative cost', {}, { cost: { estimate: -1 } }],
    ['models not an array', { models: null }, {}],
  ])('skips an invalid record: %s', (_name, over, totals) => {
    expect(summarizeLedger(rec(over, totals), TASK, READ)).toBeUndefined();
  });

  it('skips malformed lines but keeps the valid ones', () => {
    const text = ['{broken', rec({}, { input: 5 }), '', '[]', 'null'].join('\n');
    expect(summarizeLedger(text, TASK, READ)).toMatchObject({ input: 5, sessions: 1 });
  });

  it('keeps unknown and billed-credits apart from the estimate', () => {
    const text = [
      rec({}, { cost: { estimate: 1, 'billed-credits': 0.4, unknown: 2 } }),
      rec({ session: 's2' }, { cost: { 'billed-credits': 0.1 } }),
    ].join('\n');
    expect(summarizeLedger(text, TASK, READ)!.usd).toEqual({ estimate: 1, billedCredits: 0.5, unknown: 2 });
  });

  it('has an empty usd when a record carries no cost', () => {
    expect(summarizeLedger(rec({}, { cost: {} }), TASK, READ)!.usd).toEqual({});
  });

  it('does not accept inherited property names as cost sources', () => {
    expect(summarizeLedger(rec({}, { cost: { constructor: 1 } }), TASK, READ)).toBeUndefined();
    expect(summarizeLedger(rec({}, { cost: { ["__proto__"]: 1 } }), TASK, READ)).toBeUndefined();
  });
});
