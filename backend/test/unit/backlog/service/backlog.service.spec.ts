import { Logger } from '@nestjs/common';
import { BacklogConflictError, BacklogInvalidError, BacklogNotFoundError, BacklogUnreachableError } from '../../../../src/backlog/service/backlog-errors';
import { Item } from '../../../../src/backlog/service/backlog-connector';
import { BacklogStore } from '../../../../src/backlog/service/backlog-store';
import { BacklogChange, BacklogUpdates } from '../../../../src/backlog/service/backlog-updates';
import { BacklogTriggers, TriggerEvent } from '../../../../src/backlog/service/backlog-triggers';
import { BacklogService } from '../../../../src/backlog/service/backlog.service';
import { FakeConnector } from '../../../helpers/fake-connector';

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id, title: `T${id}`, description: '', lane: 'todo', assignees: [], url: `u/${id}`, fileLinks: [], updatedAt: `2026-01-0${id}T00:00:00Z`, ...over,
});

class MemStore implements BacklogStore {
  saved: Item[][] = [];
  constructor(public initial: Item[] = []) {}
  async load() { return this.initial; }
  async save(items: Item[]) { this.saved.push(items); }
}

function setup(items: Item[] = [], cached: Item[] = []) {
  const connector = new FakeConnector(items);
  const store = new MemStore(cached);
  const updates = new BacklogUpdates();
  const triggers = new BacklogTriggers();
  const config = { lanes: [{ id: 'todo', title: 'To do', default: true }, { id: 'plan', title: 'Plan', trigger: 'plan.enter' }, { id: 'doing', title: 'Doing' }] };
  const service = new BacklogService(connector, store, updates, triggers, config);
  const changes: BacklogChange[] = [];
  const events: TriggerEvent[] = [];
  updates.changes.subscribe((c) => changes.push(c));
  triggers.events.subscribe((e) => events.push(e));
  return { connector, store, service, changes, events };
}

describe('BacklogService', () => {
  it('refresh publishes new, changed and removed items and no trigger event', async () => {
    const { connector, service, changes, events } = setup([item('1'), item('2')], [item('2', { title: 'old' }), item('3')]);
    const result = await service.refresh();
    expect(changes).toEqual(expect.arrayContaining([
      { kind: 'item', item: item('1') }, { kind: 'item', item: item('2') }, { kind: 'removed', id: '3' },
    ]));
    expect(changes).toHaveLength(3);
    expect(result.map((i) => i.id)).toEqual(['2', '1']);
    expect(events).toEqual([]);
    changes.length = 0;
    await service.refresh();
    expect(changes).toEqual([]);
    expect(connector.moves).toEqual([]);
  });

  it('refresh keeps the cache and publishes an error when the source is unreachable', async () => {
    const { connector, service, changes, store } = setup([], [item('1')]);
    connector.failure = new BacklogUnreachableError();
    const result = await service.refresh();
    expect(result).toEqual([item('1')]);
    expect(changes).toEqual([{ kind: 'error', message: 'Backlog source is unreachable' }]);
    expect(store.saved).toEqual([]);
  });

  it('move writes through, updates the cache, publishes and emits the lane trigger', async () => {
    const { connector, service, changes, events } = setup([item('1')], [item('1')]);
    const moved = await service.move('1', 'todo', 'plan');
    expect(connector.moves).toEqual([{ id: '1', from: 'todo', to: 'plan' }]);
    expect(moved.lane).toBe('plan');
    expect((await service.get('1')).lane).toBe('plan');
    expect(changes).toEqual([{ kind: 'item', item: moved }]);
    expect(events).toEqual([expect.objectContaining({ itemId: '1', from: 'todo', to: 'plan', trigger: 'plan.enter' })]);
  });

  it('move into a lane without trigger emits no event', async () => {
    const { service, events } = setup([item('1')], [item('1')]);
    await service.move('1', 'todo', 'doing');
    expect(events).toEqual([]);
  });

  it('a stale from is a conflict: nothing moved, no event, item refreshed in the cache', async () => {
    const { connector, service, events } = setup([item('1', { lane: 'doing' })], [item('1')]);
    await expect(service.move('1', 'todo', 'plan')).rejects.toBeInstanceOf(BacklogConflictError);
    expect(connector.moves).toEqual([]);
    expect(events).toEqual([]);
    expect((await service.get('1')).lane).toBe('doing');
  });

  it('move to an unknown lane is invalid', async () => {
    const { connector, service } = setup([item('1')], [item('1')]);
    await expect(service.move('1', 'todo', 'nope')).rejects.toEqual(new BacklogInvalidError('Unknown lane'));
    expect(connector.moves).toEqual([]);
  });

  it('lanes returns the user once read at init and the configured lanes', async () => {
    const { service } = setup();
    expect(service.lanes().me).toBe('');
    service.onModuleInit();
    await new Promise((r) => setTimeout(r, 0));
    expect(service.lanes()).toEqual({ me: 'me', lanes: [{ id: 'todo', title: 'To do' }, { id: 'plan', title: 'Plan' }, { id: 'doing', title: 'Doing' }] });
  });

  it('a failing me() is tolerated', async () => {
    const { connector, service } = setup();
    connector.failure = new BacklogUnreachableError();
    service.onModuleInit();
    await new Promise((r) => setTimeout(r, 0));
    expect(service.lanes().me).toBe('');
  });

  it('a move that completes while a refresh is reading the source is not reverted by it', async () => {
    const { connector, service } = setup([item('1')], [item('1')]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const list = connector.list.bind(connector);
    connector.list = async () => {
      const snapshot = await list();
      await gate;
      return snapshot;
    };
    const refreshing = service.refresh();
    await service.move('1', 'todo', 'doing');
    release();
    await refreshing;
    expect((await service.get('1')).lane).toBe('doing');
  });

  it('a refresh does not delete an item added while it was reading the source', async () => {
    const { connector, service } = setup([], []);
    connector.items.set('9', item('9'));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    connector.list = async () => { await gate; return []; };
    const refreshing = service.refresh();
    await service.get('9');
    release();
    await refreshing;
    expect((await service.list()).map((i) => i.id)).toEqual(['9']);
  });

  it('does not publish or log the message of an unexpected connector error', async () => {
    const { connector, service, changes } = setup([], [item('1')]);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    connector.failure = new Error('https://gitlab.example/secret-token-abc');
    await service.refresh();
    service.onModuleInit();
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.stringify(changes)).not.toContain('secret-token-abc');
    expect(changes).toEqual([{ kind: 'error', message: 'Backlog source failed' }]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-token-abc');
    warn.mockRestore();
  });

  it('a failing cache save does not fail a move that the source accepted', async () => {
    const { store, service, changes, events } = setup([item('1')], [item('1')]);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    store.save = async () => { throw new Error('EACCES /data/secret'); };
    const moved = await service.move('1', 'todo', 'plan');
    expect(moved.lane).toBe('plan');
    expect(changes).toEqual([{ kind: 'item', item: moved }]);
    expect(events).toEqual([expect.objectContaining({ trigger: 'plan.enter' })]);
    warn.mockRestore();
  });

  it('setFileLinks stores through the connector and updates the cache', async () => {
    const { service } = setup([item('1')], [item('1')]);
    const links = [{ repo: 'g/p', path: 'a.md' }];
    expect(await service.setFileLinks('1', links)).toEqual(links);
    expect((await service.get('1')).fileLinks).toEqual(links);
  });

  it('create writes through, publishes the item and emits no trigger event', async () => {
    const { connector, service, changes, events } = setup([], []);
    const created = await service.create({ title: 'New', lane: 'plan' });
    expect(created).toMatchObject({ title: 'New', lane: 'plan' });
    expect(connector.creates).toEqual([{ title: 'New', lane: 'plan' }]);
    expect(changes).toEqual([{ kind: 'item', item: created }]);
    expect(events).toEqual([]);
    expect(await service.list()).toEqual([created]);
  });

  it('create refuses an unknown lane and surfaces the connector rejecting a closed lane', async () => {
    const { connector, service, changes } = setup([], []);
    await expect(service.create({ title: 'N', lane: 'nowhere' })).rejects.toBeInstanceOf(BacklogInvalidError);
    await expect(service.create({ title: 'N', lane: 'closed-lane' })).rejects.toBeInstanceOf(BacklogInvalidError);
    expect(connector.creates).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('update writes through, publishes the item and emits no trigger event', async () => {
    const { connector, service, changes, events } = setup([item('1')], [item('1')]);
    const updated = await service.update('1', { title: 'Changed', assignees: ['bob'] });
    expect(updated.title).toBe('Changed');
    expect(connector.updates).toEqual([{ id: '1', patch: { title: 'Changed', assignees: ['bob'] } }]);
    expect(changes).toEqual([{ kind: 'item', item: updated }]);
    expect(events).toEqual([]);
    expect((await service.get('1')).title).toBe('Changed');
  });

  it('a poll that read the source before an update does not revert it', async () => {
    const { connector, service } = setup([item('1')], [item('1')]);
    const before = [item('1')];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    connector.list = async () => { await gate; return before; };
    const refreshing = service.refresh();
    await service.update('1', { title: 'Changed' });
    release();
    await refreshing;
    expect((await service.get('1')).title).toBe('Changed');
  });

  it('create and update keep working when the cache cannot be saved, and pass source errors on', async () => {
    const { connector, store, service } = setup([item('1')], [item('1')]);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    store.save = async () => { throw new Error('EACCES'); };
    await expect(service.create({ title: 'N' })).resolves.toMatchObject({ title: 'N' });
    await expect(service.update('1', { title: 'U' })).resolves.toMatchObject({ title: 'U' });
    connector.failure = new BacklogUnreachableError();
    await expect(service.update('1', { title: 'V' })).rejects.toBeInstanceOf(BacklogUnreachableError);
    warn.mockRestore();
  });

  it('onModuleInit does not wait for the current user and a later refresh fills it', async () => {
    const { connector, service } = setup([item('1')], []);
    let release!: (v: string) => void;
    connector.me = () => new Promise<string>((r) => { release = r; });
    service.onModuleInit(); // returns at once although me() never settles
    expect(service.lanes().me).toBe('');
    release('late');
    await new Promise((r) => setTimeout(r, 0));
    expect(service.lanes().me).toBe('late');
  });

  it('a refresh re-reads the current user while it is unknown', async () => {
    const { connector, service } = setup([item('1')], []);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    connector.me = async () => { throw new BacklogUnreachableError(); };
    service.onModuleInit();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(service.lanes().me).toBe('');
    connector.me = async () => 'back';
    await service.refresh();
    expect(service.lanes().me).toBe('back');
    warn.mockRestore();
  });

  it('a move keeps the cached file links when the source answers without them', async () => {
    const links = [{ repo: 'g/p', path: 'a.md' }];
    const { connector, service } = setup([item('1')], [item('1', { fileLinks: links })]);
    const moveToLane = connector.moveToLane.bind(connector);
    connector.moveToLane = async (...a) => ({ ...(await moveToLane(...a)), fileLinks: [] });
    const moved = await service.move('1', 'todo', 'doing');
    expect(moved.fileLinks).toEqual(links);
    expect((await service.get('1')).fileLinks).toEqual(links);
  });

  it('an update keeps the cached file links when the source answers without them', async () => {
    const links = [{ repo: 'g/p', path: 'a.md' }];
    const { connector, service } = setup([item('1')], [item('1', { fileLinks: links })]);
    const update = connector.update.bind(connector);
    connector.update = async (...a) => ({ ...(await update(...a)), fileLinks: [] });
    const updated = await service.update('1', { title: 'X' });
    expect(updated.fileLinks).toEqual(links);
    expect((await service.get('1')).fileLinks).toEqual(links);
  });

  it('a move into the lane the item is already in writes nothing and emits no event', async () => {
    const { connector, service, changes, events } = setup([item('1', { lane: 'plan' })], [item('1', { lane: 'plan' })]);
    const result = await service.move('1', 'plan', 'plan');
    expect(result.lane).toBe('plan');
    expect(connector.moves).toEqual([]);
    expect(changes).toEqual([]);
    expect(events).toEqual([]);
    await expect(service.move('1', 'plan', 'nope')).rejects.toBeInstanceOf(BacklogInvalidError);
  });

  it('concurrent refreshes share one read of the source and a strict caller still gets the failure', async () => {
    const { connector, service } = setup([item('1')], []);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    connector.list = async () => { reads++; await gate; throw new BacklogUnreachableError(); };
    const lenient = service.refresh();
    const strict = service.refresh({ strict: true });
    release();
    await expect(lenient).resolves.toEqual([]);
    await expect(strict).rejects.toBeInstanceOf(BacklogUnreachableError);
    expect(reads).toBe(1);
    warn.mockRestore();
  });

  it('a move of an item deleted in the source drops it from the board', async () => {
    const { connector, service, changes } = setup([], [item('1')]);
    await expect(service.move('1', 'todo', 'plan')).rejects.toBeInstanceOf(BacklogNotFoundError);
    expect(changes).toEqual([{ kind: 'removed', id: '1' }]);
    expect(await service.list()).toEqual([]);
    expect(connector.moves).toEqual([]);
  });
});
