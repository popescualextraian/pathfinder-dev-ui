import { formatCost } from '../../src/views/format-cost';
import type { TaskCost } from '../../src/api/models';

const cost = (over: Partial<TaskCost> = {}): TaskCost => ({
  input: 12300, output: 45600, cacheRead: 1_200_000, cacheWrite: 80_000,
  usd: { estimate: 1.84 }, sessions: 1, snapshotAt: '2026-10-17T10:00:00Z', readAt: '2026-10-17T10:00:01Z', ...over,
});

describe('formatCost', () => {
  it('formats usd and tokens', () => {
    expect(formatCost(cost())).toEqual({
      usd: '$1.84 (estimate)',
      tokens: 'in 12.3k · out 45.6k · cache 1.2M read / 80k write',
    });
  });
  it('shortens small counts and whole thousands', () => {
    expect(formatCost(cost({ input: 999, output: 1000, cacheRead: 0, cacheWrite: 2_000_000 })).tokens).toBe(
      'in 999 · out 1k · cache 0 read / 2M write',
    );
  });
  it('shows <$0.01 for small non-zero and $0.00 for zero', () => {
    expect(formatCost(cost({ usd: { estimate: 0.004 } })).usd).toBe('<$0.01 (estimate)');
    expect(formatCost(cost({ usd: { estimate: 0 } })).usd).toBe('$0.00 (estimate)');
  });
  it('adds credits and the unknown marker', () => {
    expect(formatCost(cost({ usd: { estimate: 1.84, billedCredits: 0.4 } })).usd).toBe('$1.84 (estimate) · $0.40 credits');
    expect(formatCost(cost({ usd: { estimate: 1.84, unknown: 2 } })).usd).toBe('$1.84 (estimate) +?');
    expect(formatCost(cost({ usd: { billedCredits: 0.4, unknown: 1 } })).usd).toBe('$0.40 credits +?');
    expect(formatCost(cost({ usd: { unknown: 1 } })).usd).toBe('+?');
  });
});
