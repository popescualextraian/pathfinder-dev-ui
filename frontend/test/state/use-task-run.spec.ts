import { buildRunItems } from '../../src/state/use-task-run';
import type { BridgeEvent } from '../../src/api/models';

const ev = (seq: number, type: string, data: Record<string, unknown>): BridgeEvent =>
  ({
    seq,
    ts: '2026-10-17T10:00:00Z',
    task: 'T-1',
    session: 's',
    agent: 'a',
    type,
    data,
  }) as BridgeEvent;
const msg = (seq: number, role: string, text: string, final: boolean) => ev(seq, 'message', { role, text, final });
const texts = (items: ReturnType<typeof buildRunItems>) =>
  items.map((i) => (i.kind === 'message' ? `${i.role}:${i.text}` : `event:${i.event.type}`));

describe('buildRunItems', () => {
  it('real turn: chunks around a tool, then final with the whole text, shows only the final', () => {
    const items = buildRunItems([
      msg(1, 'user', 'go', true),
      msg(2, 'agent', 'Let me check', false),
      ev(3, 'tool', {
        id: 't1',
        title: 'ls',
        kind: 'execute',
        status: 'completed',
      }),
      msg(4, 'agent', ' Done.', false),
      msg(5, 'agent', 'Let me check Done.', true),
    ]);
    expect(texts(items)).toEqual(['user:go', 'event:tool', 'agent:Let me check Done.']);
  });

  it('chunks without a final yet show merged when adjacent', () => {
    expect(texts(buildRunItems([msg(1, 'agent', 'Hel', false), msg(2, 'agent', 'lo', false)]))).toEqual([
      'agent:Hello',
    ]);
  });

  it('a final only drops chunks of its own turn', () => {
    const items = buildRunItems([
      msg(1, 'agent', 'old', true),
      msg(2, 'agent', 'new', false),
      msg(3, 'agent', 'new', true),
    ]);
    expect(texts(items)).toEqual(['agent:old', 'agent:new']);
  });

  it('one row per tool id, updated in place at the first position', () => {
    const items = buildRunItems([
      ev(1, 'tool', { id: 't1', title: 'ls', status: 'pending' }),
      ev(2, 'tool', { id: 't2', title: 'cat', status: 'pending' }),
      ev(3, 'tool', {
        id: 't1',
        title: 'ls',
        status: 'completed',
        output_tail: 'x',
      }),
    ]);
    expect(items).toHaveLength(2);
    const first = items[0];
    expect(first.kind === 'event' && first.event.data.status).toBe('completed');
    expect(first.kind === 'event' && first.event.data.id).toBe('t1');
  });
});
