import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BACKLOG_CONFIG, BacklogConfig } from './backlog-config';
import { BACKLOG_CONNECTOR, BacklogConnector, FileLink, Item, ItemDraft, ItemPatch } from './backlog-connector';
import { BacklogConflictError, BacklogInvalidError, BacklogNotFoundError, BacklogUnreachableError, safeMessage } from './backlog-errors';
import { BACKLOG_STORE, BacklogStore } from './backlog-store';
import { BacklogTriggers } from './backlog-triggers';
import { BacklogUpdates } from './backlog-updates';

@Injectable()
export class BacklogService implements OnModuleInit {
  private readonly logger = new Logger(BacklogService.name);
  private readonly cache = new Map<string, Item>();
  private loaded?: Promise<void>;
  // Cache writes are numbered so a refresh can tell which items changed while it waited for the source.
  private generation = 0;
  private readonly touched = new Map<string, number>();
  private me = '';
  private readingMe?: Promise<void>;
  private refreshing?: Promise<{ items: Item[]; failure?: BacklogUnreachableError }>;

  constructor(
    @Inject(BACKLOG_CONNECTOR) private readonly connector: BacklogConnector,
    @Inject(BACKLOG_STORE) private readonly store: BacklogStore,
    private readonly updates: BacklogUpdates,
    private readonly triggers: BacklogTriggers,
    @Inject(BACKLOG_CONFIG) private readonly config: Pick<BacklogConfig, 'lanes'>,
  ) {}

  // Started, not awaited: an unreachable source must not hold the application up. Refreshes retry while it is unknown.
  onModuleInit(): void {
    void this.readMe();
  }

  private readMe(): Promise<void> {
    this.readingMe ??= this.connector.me().then(
      (me) => { this.me = me; },
      (error: unknown) => { this.logger.warn(`Could not read the current user: ${safeMessage(error)}`); },
    ).finally(() => { this.readingMe = undefined; });
    return this.readingMe;
  }

  lanes(): { me: string; lanes: Array<{ id: string; title: string }> } {
    return { me: this.me, lanes: this.config.lanes.map((l) => ({ id: l.id, title: l.title })) };
  }

  async list(): Promise<Item[]> {
    await this.ensureLoaded();
    return this.sorted();
  }

  async get(id: string): Promise<Item> {
    await this.ensureLoaded();
    const cached = this.cache.get(id);
    if (cached) return cached;
    const item = await this.connector.get(id);
    await this.put(item);
    return item;
  }

  // Reads the source, publishes what differs from the cache and saves. An unreachable source keeps the cache
  // and returns it; with `strict` (a user asked for the refresh) the failure is also thrown as unreachable.
  // Concurrent callers (poller, POST /refresh) share one read, so an older snapshot cannot finish after a newer one.
  async refresh(options: { strict?: boolean } = {}): Promise<Item[]> {
    this.refreshing ??= this.runRefresh().finally(() => { this.refreshing = undefined; });
    const { items, failure } = await this.refreshing;
    if (failure && options.strict) throw failure;
    return items;
  }

  private async runRefresh(): Promise<{ items: Item[]; failure?: BacklogUnreachableError }> {
    const started = this.generation;
    await this.ensureLoaded();
    if (!this.me) await this.readMe();
    let fresh: Item[];
    try {
      fresh = await this.connector.list();
    } catch (error) {
      this.logger.warn(`Refresh failed: ${safeMessage(error)}`);
      const message = error instanceof BacklogUnreachableError ? error.message : 'Backlog source failed';
      this.updates.publish({ kind: 'error', message });
      return { items: this.sorted(), failure: new BacklogUnreachableError(message) };
    }
    const seen = new Set<string>();
    let changed = false;
    // Items written by a move, link change or get while the source was read are newer than the snapshot.
    const newer = (id: string): boolean => (this.touched.get(id) ?? 0) > started;
    for (const item of fresh) {
      seen.add(item.id);
      if (newer(item.id)) continue;
      if (differs(this.cache.get(item.id), item)) {
        this.cache.set(item.id, item);
        this.updates.publish({ kind: 'item', item });
        changed = true;
      }
    }
    for (const id of [...this.cache.keys()]) {
      if (seen.has(id) || newer(id)) continue;
      this.cache.delete(id);
      this.touched.delete(id);
      this.updates.publish({ kind: 'removed', id });
      changed = true;
    }
    if (changed) await this.save();
    return { items: this.sorted() };
  }

  async move(id: string, from: string, to: string): Promise<Item> {
    await this.ensureLoaded();
    const lane = this.config.lanes.find((l) => l.id === to);
    if (!lane) throw new BacklogInvalidError('Unknown lane');
    if (from === to) return this.get(id);
    let item: Item;
    try {
      item = await this.connector.moveToLane(id, from, to);
    } catch (error) {
      if (error instanceof BacklogConflictError) await this.reload(id);
      if (error instanceof BacklogNotFoundError) await this.drop(id);
      throw error;
    }
    item = this.keepLinks(item);
    await this.put(item);
    if (lane.trigger) this.triggers.emit({ itemId: id, from, to, trigger: lane.trigger, at: new Date().toISOString() });
    return item;
  }

  // Create and update publish the item like any change but are not board moves: no trigger event.
  async create(draft: ItemDraft): Promise<Item> {
    await this.ensureLoaded();
    if (draft.lane !== undefined && !this.config.lanes.some((l) => l.id === draft.lane)) throw new BacklogInvalidError('Unknown lane');
    const item = await this.connector.create(draft);
    await this.put(item);
    return item;
  }

  async update(id: string, patch: ItemPatch): Promise<Item> {
    await this.ensureLoaded();
    const item = this.keepLinks(await this.connector.update(id, patch));
    await this.put(item);
    return item;
  }

  async setFileLinks(id: string, links: FileLink[]): Promise<FileLink[]> {
    await this.ensureLoaded();
    const saved = await this.connector.setFileLinks(id, links);
    const cached = this.cache.get(id);
    if (cached) await this.put({ ...cached, fileLinks: saved });
    return saved;
  }

  // The board's copy of an item the source disagrees with is replaced; a failing source leaves the cache.
  private async reload(id: string): Promise<void> {
    try {
      await this.put(await this.connector.get(id));
    } catch (error) {
      this.logger.warn(`Could not reload item ${id}: ${safeMessage(error)}`);
    }
  }

  // Links change only through setFileLinks and the poll; a move or update whose notes read failed must not erase them.
  private keepLinks(item: Item): Item {
    return { ...item, fileLinks: this.cache.get(item.id)?.fileLinks ?? item.fileLinks };
  }

  private async drop(id: string): Promise<void> {
    if (!this.cache.delete(id)) return;
    this.touched.set(id, ++this.generation);
    this.updates.publish({ kind: 'removed', id });
    await this.save();
  }

  private async put(item: Item): Promise<void> {
    this.cache.set(item.id, item);
    this.touched.set(item.id, ++this.generation);
    this.updates.publish({ kind: 'item', item });
    await this.save();
  }

  // The source is the truth and the cache is rebuilt from it, so a failing write is not an error for the caller.
  private async save(): Promise<void> {
    try {
      await this.store.save([...this.cache.values()]);
    } catch (error) {
      this.logger.warn(`Could not save the cache: ${safeMessage(error)}`);
    }
  }

  private sorted(): Item[] {
    return [...this.cache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private ensureLoaded(): Promise<void> {
    this.loaded ??= this.store.load().then(
      (items) => { for (const item of items) this.cache.set(item.id, item); },
      (error: unknown) => { this.logger.warn(`Could not load the cache: ${safeMessage(error)}`); },
    );
    return this.loaded;
  }
}

function differs(a: Item | undefined, b: Item): boolean {
  return !a || JSON.stringify(a) !== JSON.stringify(b);
}
