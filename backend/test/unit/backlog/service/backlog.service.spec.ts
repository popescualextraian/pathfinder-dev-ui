import { BacklogConflictError, BacklogNotFoundError, BacklogUnreachableError } from '../../../../src/backlog/service/backlog-errors';
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

  it('move to an unknown lane is not found', async () => {
    const { connector, service } = setup([item('1')], [item('1')]);
    await expect(service.move('1', 'todo', 'nope')).rejects.toEqual(new BacklogNotFoundError('lane'));
    expect(connector.moves).toEqual([]);
  });

  it('lanes returns the user once read at init and the configured lanes', async () => {
    const { service } = setup();
    expect(service.lanes().me).toBe('');
    await service.onModuleInit();
    expect(service.lanes()).toEqual({ me: 'me', lanes: [{ id: 'todo', title: 'To do' }, { id: 'plan', title: 'Plan' }, { id: 'doing', title: 'Doing' }] });
  });

  it('a failing me() is tolerated', async () => {
    const { connector, service } = setup();
    connector.failure = new BacklogUnreachableError();
    await service.onModuleInit();
    expect(service.lanes().me).toBe('');
  });

  it('setFileLinks stores through the connector and updates the cache', async () => {
    const { service } = setup([item('1')], [item('1')]);
    const links = [{ repo: 'g/p', path: 'a.md' }];
    expect(await service.setFileLinks('1', links)).toEqual(links);
    expect((await service.get('1')).fileLinks).toEqual(links);
  });
});
