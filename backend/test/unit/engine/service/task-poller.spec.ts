import { Logger } from '@nestjs/common';
import { BridgeError, BridgeEvent, BridgeUnreachableError } from '../../../../src/engine/service/bridge-client';
import { applyEvents, TaskPoller } from '../../../../src/engine/service/task-poller';
import { TaskUpdates } from '../../../../src/engine/service/task-updates';
import { TaskCostService } from '../../../../src/engine/service/cost/task-cost.service';
import { fakeLauncher, fakeRecords, record, status } from './helpers';

// A scripted bridge per task: serves GET /events?view=status after `since` from its list.
class Bridge {
  events: BridgeEvent[] = [];
  calls: { since: number; limit?: number; view?: string }[] = [];
  failWith?: Error;
  gate?: Promise<void>;
  seqCounter = 0;

  push(type: BridgeEvent['type'], data: Record<string, unknown>, seq?: number): BridgeEvent {
    this.seqCounter = seq ?? this.seqCounter + 1;
    const e: BridgeEvent = { seq: this.seqCounter, ts: `2026-01-01T00:00:${String(this.seqCounter % 60).padStart(2, '0')}.000Z`, task: 'T', session: null, agent: 'fake', type, data };
    this.events.push(e);
    return e;
  }

  client() {
    return {
      events: jest.fn(async (since: number, limit?: number, view?: string) => {
        this.calls.push({ since, limit, view });
        await this.gate;
        if (this.failWith) throw this.failWith;
        return this.events.filter((e) => e.seq > since).slice(0, limit ?? 1000);
      }),
    };
  }
}

const ids = ['T-20260101-aaaa', 'T-20260101-bbbb', 'T-20260101-cccc', 'T-20260101-dddd', 'T-20260101-eeee', 'T-20260101-ffff'];

function setup(states: Record<string, Partial<ReturnType<typeof record>>>, pollSeconds = 15) {
  const bridges = new Map<string, Bridge>();
  const records = fakeRecords(Object.entries(states).map(([id, over]) => record({ id, bridgeUrl: `http://${id}`, ...over })));
  for (const id of Object.keys(states)) bridges.set(id, new Bridge());
  const clients = new Map([...bridges].map(([id, b]) => [id, b.client()]));
  const factory = jest.fn((rec: { bridgeUrl?: string }) => clients.get(rec.bridgeUrl!.slice('http://'.length))!);
  const updates = new TaskUpdates();
  const published: { kind: string; task?: { id: string; state: string; section: string; lastMessage?: string; questions: { id: string }[] } }[] = [];
  updates.changes.subscribe((c) => published.push(c as never));
  const costs = new TaskCostService(records as never, fakeLauncher() as never);
  jest.spyOn(costs, 'refresh').mockResolvedValue(undefined);
  const poller = new TaskPoller(records as never, factory as never, updates, { pollSeconds }, costs as never);
  return { poller, records, bridges, updates, published, factory, clients, costs };
}

describe('TaskPoller cost', () => {
  const id = ids[0];
  beforeEach(() => { jest.spyOn(Logger.prototype, 'warn').mockImplementation(); });
  afterEach(() => jest.restoreAllMocks());

  it('a turn end arms the recheck: read in the same round and the next two, then no more', async () => {
    const { poller, bridges, records, costs } = setup({ [id]: { lastState: 'running' } });
    bridges.get(id)!.push('state', { state: 'idle', reason: '' });
    await poller.tick();
    expect(costs.refresh).toHaveBeenCalledTimes(1);
    expect(records.map.get(id)!.costRecheck).toBe(2);
    await poller.tick();
    await poller.tick();
    expect(costs.refresh).toHaveBeenCalledTimes(3);
    expect(records.map.get(id)!.costRecheck).toBe(0);
    await poller.tick();
    expect(costs.refresh).toHaveBeenCalledTimes(3);
  });

  it('one failing recheck does not stop the others', async () => {
    const { poller, costs } = setup({ [ids[0]]: { lastState: 'idle', costRecheck: 2 }, [ids[1]]: { lastState: 'idle', costRecheck: 2 } });
    (costs.refresh as jest.Mock).mockRejectedValueOnce(new Error('gone'));
    await poller.tick();
    expect(costs.refresh).toHaveBeenCalledTimes(2);
  });

  it('no turn end, no read; a closed task is not read', async () => {
    const { poller, bridges, costs } = setup({ [id]: { lastState: 'running' }, [ids[1]]: { lastState: 'idle', closed: true, costRecheck: 2 } });
    bridges.get(id)!.push('state', { state: 'running', reason: '' });
    await poller.tick();
    expect(costs.refresh).not.toHaveBeenCalled();
  });
});

describe('TaskPoller', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => { warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(); });
  afterEach(() => { warn.mockRestore(); jest.useRealTimers(); });

  describe('what is polled', () => {
    it('polls starting and running tasks only, never idle, suspended, stopped or closed ones', async () => {
      const { poller, bridges } = setup({
        [ids[0]]: { lastState: 'running' },
        [ids[1]]: { lastState: 'starting' },
        [ids[2]]: { lastState: 'idle' },
        [ids[3]]: { lastState: 'suspended' },
        [ids[4]]: { lastState: 'stopped' },
        [ids[5]]: { lastState: 'running', closed: true },
      });
      await poller.tick();
      expect([...bridges].filter(([, b]) => b.calls.length > 0).map(([id]) => id)).toEqual([ids[0], ids[1]]);
    });

    it('asks for the status view after the saved cursor', async () => {
      const { poller, bridges } = setup({ [ids[0]]: { lastState: 'running', lastSeq: 41 } });
      await poller.tick();
      expect(bridges.get(ids[0])!.calls).toEqual([{ since: 41, limit: 1000, view: 'status' }]);
    });

    it('polls a task we just acted on once, even when it is idle, and not again after success', async () => {
      const { poller, bridges, updates } = setup({ [ids[0]]: { lastState: 'idle' } });
      await poller.tick();
      expect(bridges.get(ids[0])!.calls).toHaveLength(0);
      updates.markActed(ids[0]);
      await poller.tick();
      expect(bridges.get(ids[0])!.calls).toHaveLength(1);
      expect(updates.actedIds().size).toBe(0);
      await poller.tick();
      expect(bridges.get(ids[0])!.calls).toHaveLength(1);
    });

    it('keeps the note of an acted-on task when its poll fails', async () => {
      const { poller, bridges, updates } = setup({ [ids[0]]: { lastState: 'idle' } });
      bridges.get(ids[0])!.failWith = new BridgeUnreachableError('ECONNREFUSED');
      updates.markActed(ids[0]);
      await poller.tick();
      expect(updates.actedIds().has(ids[0])).toBe(true);
      bridges.get(ids[0])!.failWith = undefined;
      await poller.tick();
      expect(bridges.get(ids[0])!.calls).toHaveLength(2);
      expect(updates.actedIds().size).toBe(0);
    });

    it('does not poll an acted-on task that is stopped or closed', async () => {
      const { poller, bridges, updates } = setup({ [ids[0]]: { lastState: 'stopped' }, [ids[1]]: { lastState: 'stopped', closed: true } });
      updates.markActed(ids[0]);
      updates.markActed(ids[1]);
      await poller.tick();
      expect(bridges.get(ids[0])!.calls).toHaveLength(0);
      expect(bridges.get(ids[1])!.calls).toHaveLength(0);
    });
  });

  describe('timing', () => {
    it('polls every ENGINE_POLL_SECONDS and stops with the module', async () => {
      jest.useFakeTimers();
      const { poller, bridges } = setup({ [ids[0]]: { lastState: 'running' } }, 15);
      poller.onModuleInit();
      await jest.advanceTimersByTimeAsync(14_999);
      expect(bridges.get(ids[0])!.calls).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(1);
      expect(bridges.get(ids[0])!.calls).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(15_000);
      expect(bridges.get(ids[0])!.calls).toHaveLength(2);
      await poller.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(bridges.get(ids[0])!.calls).toHaveLength(2);
    });

    it('does not start a round while the last one is still running', async () => {
      jest.useFakeTimers();
      const { poller, bridges } = setup({ [ids[0]]: { lastState: 'running' } }, 1);
      let release!: () => void;
      bridges.get(ids[0])!.gate = new Promise<void>((resolve) => { release = resolve; });
      poller.onModuleInit();
      await jest.advanceTimersByTimeAsync(3_000);
      expect(bridges.get(ids[0])!.calls).toHaveLength(1);
      release();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(bridges.get(ids[0])!.calls).toHaveLength(2);
      await poller.onModuleDestroy();
    });

    it('lets a slow bridge hold up only itself (a few polls run at once)', async () => {
      const { poller, bridges, records } = setup(Object.fromEntries(ids.map((id) => [id, { lastState: 'running' }])));
      let release!: () => void;
      bridges.get(ids[0])!.gate = new Promise<void>((resolve) => { release = resolve; });
      for (const id of ids) {
        const b = bridges.get(id)!;
        b.push('state', { state: 'idle', reason: '' });
      }
      const round = poller.tick();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      for (const id of ids.slice(1)) expect(records.map.get(id)!.lastState).toBe('idle');
      expect(records.map.get(ids[0])!.lastState).toBe('running');
      release();
      await round;
      expect(records.map.get(ids[0])!.lastState).toBe('idle');
    });

    it('polls at most four tasks at the same time', async () => {
      const { poller, bridges } = setup(Object.fromEntries(ids.map((id) => [id, { lastState: 'running' }])));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      for (const b of bridges.values()) b.gate = gate;
      const round = poller.tick();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect([...bridges.values()].filter((b) => b.calls.length > 0)).toHaveLength(4);
      release();
      await round;
      expect([...bridges.values()].filter((b) => b.calls.length > 0)).toHaveLength(6);
    });
  });

  describe('what the events change', () => {
    const id = ids[0];

    it('takes the state and its reason, and announces the task in its new section', async () => {
      const { poller, bridges, records, published } = setup({ [id]: { lastState: 'running' } });
      bridges.get(id)!.push('state', { state: 'idle', reason: 'turn ended' });
      await poller.tick();
      expect(records.map.get(id)).toMatchObject({ lastState: 'idle', lastSeq: 1, lastStatus: { state: 'idle', reason: 'turn ended' } });
      expect(published).toEqual([{ kind: 'task', task: expect.objectContaining({ id, state: 'idle', section: 'in-review', reason: 'turn ended' }) }]);
    });

    it('keeps the whole final message, however long, and ignores chunks and user messages', async () => {
      const { poller, bridges, records } = setup({ [id]: { lastState: 'running' } });
      const long = 'x'.repeat(5_000);
      const b = bridges.get(id)!;
      b.push('message', { role: 'agent', text: 'chunk', final: false });
      b.push('message', { role: 'user', text: 'user text', final: true });
      const final = b.push('message', { role: 'agent', text: long, final: true });
      await poller.tick();
      expect(records.map.get(id)!.lastMessage).toBe(long);
      expect(records.map.get(id)!.lastMessageAt).toBe(final.ts);
    });

    it('the latest final message wins', async () => {
      const { poller, bridges, records } = setup({ [id]: { lastState: 'running' } });
      const b = bridges.get(id)!;
      b.push('message', { role: 'agent', text: 'first', final: true });
      b.push('message', { role: 'agent', text: 'second', final: true });
      await poller.tick();
      expect(records.map.get(id)!.lastMessage).toBe('second');
    });

    it('adds a question with its options and time, and removes it on its answer', async () => {
      const { poller, bridges, records, published, updates } = setup({ [id]: { lastState: 'running' } });
      const b = bridges.get(id)!;
      const q = b.push('question', { id: 'Q1', source: 'ask', text: 'Which file?', options: ['a', 'b'], recommendation: 'a' });
      b.push('state', { state: 'waiting', reason: 'question Q1' });
      await poller.tick();
      expect(records.map.get(id)!.lastState).toBe('waiting');
      expect(published[0].task).toMatchObject({
        state: 'waiting', section: 'needs-you',
        questions: [{ id: 'Q1', source: 'ask', text: 'Which file?', options: ['a', 'b'], recommendation: 'a', asked: q.ts }],
      });
      updates.markActed(id); // the answer went through our API
      b.push('answer', { question: 'Q1', text: 'a', grant: [] });
      b.push('state', { state: 'running', reason: '' });
      await poller.tick();
      expect(records.map.get(id)!.lastState).toBe('running');
      expect(published[1].task).toMatchObject({ state: 'running', section: 'working', questions: [] });
    });

    it('keeps another open question when one is answered', async () => {
      const { poller, bridges, published } = setup({ [id]: { lastState: 'running' } });
      const b = bridges.get(id)!;
      b.push('question', { id: 'Q1', source: 'permission', text: 'a?', options: [], recommendation: null });
      b.push('question', { id: 'Q2', source: 'ask', text: 'b?', options: [], recommendation: null });
      b.push('answer', { question: 'Q1', text: 'ok', grant: [] });
      await poller.tick();
      expect(published[0].task!.questions.map((q) => q.id)).toEqual(['Q2']);
    });

    it('closes open questions when the task goes quiet (idle, failed, stopped, ...)', async () => {
      const q = [{ id: 'Q1', source: 'ask' as const, text: 't', options: [], recommendation: null, asked: 'x' }];
      const { poller, bridges, records } = setup({ [id]: { lastState: 'running', lastStatus: status({ questions: q }) } });
      bridges.get(id)!.push('state', { state: 'failed', reason: 'agent exited' });
      await poller.tick();
      expect((records.map.get(id)!.lastStatus as { questions: unknown[] }).questions).toEqual([]);
    });

    it('a question asked after the task went idle stays open', async () => {
      const { poller, bridges, records } = setup({ [id]: { lastState: 'running' } });
      const b = bridges.get(id)!;
      b.push('state', { state: 'idle', reason: '' });
      b.push('question', { id: 'Q1', source: 'ask', text: 't', options: [], recommendation: null });
      b.push('state', { state: 'waiting', reason: 'question Q1' });
      await poller.tick();
      expect((records.map.get(id)!.lastStatus as { questions: { id: string }[] }).questions.map((x) => x.id)).toEqual(['Q1']);
    });

    it('writes and announces nothing when there is nothing new', async () => {
      const { poller, records, published } = setup({ [id]: { lastState: 'running' } });
      await poller.tick();
      expect(records.update).not.toHaveBeenCalled();
      expect(published).toEqual([]);
    });

    it('does not announce an event that changes nothing visible', async () => {
      const { poller, bridges, records, published } = setup({ [id]: { lastState: 'running' } });
      bridges.get(id)!.push('error', { message: 'boom' });
      await poller.tick();
      expect(records.map.get(id)!.lastSeq).toBe(1);
      expect(published).toEqual([]);
    });
  });

  describe('the cursor', () => {
    const id = ids[0];

    it('reads each event once across rounds, and follows the seq of the status view (with gaps)', async () => {
      const { poller, bridges, records, published } = setup({ [id]: { lastState: 'running' } });
      const b = bridges.get(id)!;
      b.push('message', { role: 'agent', text: 'one', final: true }, 3);
      b.push('state', { state: 'idle', reason: '' }, 9);
      await poller.tick();
      expect(records.map.get(id)!.lastSeq).toBe(9);
      await poller.tick(); // idle now: not polled
      b.push('message', { role: 'agent', text: 'two', final: true }, 14);
      records.map.get(id)!.lastState = 'running';
      await poller.tick();
      expect(b.calls.map((c) => c.since)).toEqual([0, 9]);
      expect(records.map.get(id)!.lastMessage).toBe('two');
      expect(published.map((p) => p.task!.lastMessage)).toEqual(['one', 'two']);
    });

    it('loses nothing when more than one page is waiting', async () => {
      const { poller, bridges, records } = setup({ [id]: { lastState: 'running' } });
      const b = bridges.get(id)!;
      for (let i = 0; i < 1_005; i++) b.push('answer', { question: `none-${i}`, text: 'x', grant: [] });
      b.push('message', { role: 'agent', text: 'last', final: true });
      await poller.tick();
      expect(b.calls.map((c) => c.since)).toEqual([0, 1000]);
      expect(records.map.get(id)).toMatchObject({ lastSeq: 1006, lastMessage: 'last' });
    });

    it('continues from the saved seq after an app restart, without duplicates', async () => {
      const first = setup({ [id]: { lastState: 'running' } });
      const b = first.bridges.get(id)!;
      b.push('question', { id: 'Q1', source: 'ask', text: 't', options: [], recommendation: null });
      await first.poller.tick();
      const saved = first.records.map.get(id)!;

      // "restart": new poller, new updates, same record and same bridge
      const records = fakeRecords([saved]);
      const updates = new TaskUpdates();
      const published: unknown[] = [];
      updates.changes.subscribe((c) => published.push(c));
      const restarted = new TaskPoller(records as never, (() => b.client()) as never, updates, { pollSeconds: 15 }, first.costs as never);
      b.push('state', { state: 'waiting', reason: 'question Q1' });
      await restarted.tick();
      expect(b.calls[b.calls.length - 1].since).toBe(1);
      const stored = records.map.get(id)!;
      expect((stored.lastStatus as { questions: unknown[] }).questions).toHaveLength(1);
      expect(stored.lastSeq).toBe(2);
    });

    it('ignores events at or before the cursor of the record it re-read', () => {
      const rec = record({ lastSeq: 5, lastState: 'running' });
      const events: BridgeEvent[] = [
        { seq: 5, ts: 't', task: 'T', session: null, agent: 'a', type: 'state', data: { state: 'idle', reason: '' } },
      ];
      expect(applyEvents(rec, events)).toBeUndefined();
    });
  });

  describe('failures', () => {
    it('logs a failed poll, leaves the record alone, polls the others, and retries next round', async () => {
      const { poller, bridges, records, published } = setup({ [ids[0]]: { lastState: 'running' }, [ids[1]]: { lastState: 'running' } });
      bridges.get(ids[0])!.failWith = new BridgeUnreachableError('ECONNREFUSED');
      bridges.get(ids[0])!.push('state', { state: 'idle', reason: '' });
      bridges.get(ids[1])!.push('state', { state: 'idle', reason: '' });
      await poller.tick();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(ids[0]));
      expect(records.map.get(ids[0])).toMatchObject({ lastState: 'running' });
      expect(records.map.get(ids[0])!.lastSeq).toBeUndefined();
      expect(records.map.get(ids[1])!.lastState).toBe('idle');
      expect(published).toHaveLength(1);
      bridges.get(ids[0])!.failWith = undefined;
      await poller.tick();
      expect(records.map.get(ids[0])!.lastState).toBe('idle');
    });

    it.each([
      ['a bridge error', new BridgeError(503, 'starting', 'starting')],
      ['an unreachable bridge', new BridgeUnreachableError('timeout')],
      ['a plain error', new Error('boom')],
    ])('survives %s without changing the state', async (_label, error) => {
      const { poller, bridges, records } = setup({ [ids[0]]: { lastState: 'starting' } });
      bridges.get(ids[0])!.failWith = error;
      await expect(poller.tick()).resolves.toBeUndefined();
      expect(records.map.get(ids[0])!.lastState).toBe('starting');
    });

    it('survives a failing record list', async () => {
      const { poller, records } = setup({ [ids[0]]: { lastState: 'running' } });
      records.list.mockRejectedValueOnce(new Error('disk'));
      await expect(poller.tick()).resolves.toBeUndefined();
      await poller.tick();
    });

    it('does not undo a stop that came in while the bridge was asked', async () => {
      const { poller, bridges, records } = setup({ [ids[0]]: { lastState: 'running' } });
      const b = bridges.get(ids[0])!;
      b.push('state', { state: 'running', reason: '' });
      let release!: () => void;
      b.gate = new Promise<void>((resolve) => { release = resolve; });
      const round = poller.tick();
      await new Promise((resolve) => setImmediate(resolve));
      records.map.set(ids[0], { ...records.map.get(ids[0])!, lastState: 'stopped' });
      release();
      await round;
      expect(records.map.get(ids[0])).toMatchObject({ lastState: 'stopped' });
      expect(records.map.get(ids[0])!.lastSeq).toBeUndefined();
    });

    it('does not poll a record that has no bridge URL yet', async () => {
      const { poller, bridges } = setup({ [ids[0]]: { lastState: 'starting', bridgeUrl: undefined } });
      await poller.tick();
      expect(bridges.get(ids[0])!.calls).toHaveLength(0);
    });

    it('drops the result when the task was closed while its bridge was asked', async () => {
      const { poller, bridges, records } = setup({ [ids[0]]: { lastState: 'running' } });
      const b = bridges.get(ids[0])!;
      b.push('state', { state: 'idle', reason: '' });
      let release!: () => void;
      b.gate = new Promise<void>((resolve) => { release = resolve; });
      const round = poller.tick();
      await new Promise((resolve) => setImmediate(resolve));
      records.map.set(ids[0], { ...records.map.get(ids[0])!, closed: true, lastState: 'stopped' });
      release();
      await round;
      expect(records.map.get(ids[0])!.lastState).toBe('stopped');
    });
  });
});

describe('applyEvents sessions', () => {
  const ev = (seq: number, type: BridgeEvent['type'], data: Record<string, unknown>, name?: string): BridgeEvent => ({
    seq, ts: `2026-01-01T00:00:0${seq}.000Z`, task: 'T', session: null, ...(name !== undefined ? { name } : {}), agent: 'fake', type, data,
  });

  it('keeps the last final agent message per session and at task level', () => {
    const patch = applyEvents(record({ lastState: 'running' }), [
      ev(1, 'message', { role: 'agent', final: true, text: 'main one' }, 'main'),
      ev(2, 'message', { role: 'agent', final: true, text: 'impl one' }, 'impl'),
      ev(3, 'message', { role: 'agent', final: false, text: 'partial' }, 'main'),
      ev(4, 'message', { role: 'user', final: true, text: 'user' }, 'main'),
    ])!;
    expect(patch.lastMessage).toBe('impl one');
    expect(patch.sessions!.map((s) => [s.name, s.lastMessage])).toEqual([['main', 'main one'], ['impl', 'impl one']]);
  });

  it('puts questions on the session that asked and a session state does not change the task state', () => {
    const patch = applyEvents(record({ lastState: 'running' }), [
      ev(1, 'question', { id: 'Q1', source: 'ask', text: 't' }, 'impl'),
      ev(2, 'state', { state: 'waiting', reason: 'question Q1' }, 'impl'),
      ev(3, 'question', { id: 'Q2', source: 'ask', text: 't' }),
    ])!;
    expect((patch.lastStatus as { questions: { id: string; session: string }[] }).questions.map((q) => [q.id, q.session])).toEqual([['Q1', 'impl'], ['Q2', 'main']]);
    expect(patch.lastState).toBeUndefined();
    expect(patch.sessions![0]).toMatchObject({ name: 'impl', state: 'waiting' });
  });

  it('a session going quiet clears only its questions; a task-level state works as before', () => {
    const rec = record({
      lastState: 'waiting',
      lastStatus: { questions: [{ id: 'Q1', session: 'impl' }, { id: 'Q2', session: 'main' }] },
      sessions: [{ name: 'impl', state: 'waiting', createdAt: '2026-01-01T00:00:00Z' }],
    });
    const patch = applyEvents(rec, [ev(1, 'state', { state: 'idle', reason: '' }, 'impl')])!;
    expect((patch.lastStatus as { questions: { id: string }[] }).questions.map((q) => q.id)).toEqual(['Q2']);
    expect(patch.sessions![0].state).toBe('idle');
    const task = applyEvents(rec, [ev(1, 'state', { state: 'idle', reason: '' })])!;
    expect(task.lastState).toBe('idle');
    expect(task.sessions).toBeUndefined();
  });
});

