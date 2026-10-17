import { act, renderHook } from '@testing-library/react';
import { buildRunItems, useTaskRun } from '../../src/state/use-task-run';
import { FakeEventSource } from '../api/fake-event-source';
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

describe('useTaskRun', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeEventSource.install();
  });
  afterEach(() => jest.useRealTimers());

  it('open followed by an error does not reset the failure counter: gives up after 5', () => {
    const { result } = renderHook(() => useTaskRun('T-1'));
    for (let i = 0; i < 5; i++) {
      const es = FakeEventSource.last;
      act(() => es.emit('open'));
      act(() => es.emit('error'));
      act(() => {
        jest.advanceTimersByTime(2500);
      });
    }
    expect(FakeEventSource.instances).toHaveLength(5);
    expect(result.current.error).toBe(true);
    expect(result.current.connected).toBe(false);
  });

  it('batches events, dedupes by seq and keeps them ordered', () => {
    const { result } = renderHook(() => useTaskRun('T-1'));
    const es = FakeEventSource.last;
    act(() => {
      es.emit('message', msg(2, 'agent', 'b', true));
      es.emit('message', msg(1, 'user', 'a', true));
      es.emit('message', msg(2, 'agent', 'b', true));
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(result.current.connected).toBe(true);
    expect(result.current.error).toBe(false);
  });
});
