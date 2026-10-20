import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BACKLOG_CONFIG, BacklogConfig } from './backlog-config';
import { BACKLOG_CONNECTOR, BacklogConnector, FileLink, Item } from './backlog-connector';
import { BacklogConflictError, BacklogNotFoundError } from './backlog-errors';
import { BACKLOG_STORE, BacklogStore } from './backlog-store';
import { BacklogTriggers } from './backlog-triggers';
import { BacklogUpdates } from './backlog-updates';

@Injectable()
export class BacklogService implements OnModuleInit {
  private readonly logger = new Logger(BacklogService.name);
  private readonly cache = new Map<string, Item>();
  private loaded?: Promise<void>;
  private me = '';

  constructor(
    @Inject(BACKLOG_CONNECTOR) private readonly connector: BacklogConnector,
    @Inject(BACKLOG_STORE) private readonly store: BacklogStore,
    private readonly updates: BacklogUpdates,
    private readonly triggers: BacklogTriggers,
    @Inject(BACKLOG_CONFIG) private readonly config: Pick<BacklogConfig, 'lanes'>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.me = await this.connector.me();
    } catch (error) {
      this.logger.warn(`Could not read the current user: ${describe(error)}`);
    }
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

  // Reads the source, publishes what differs from the cache and saves. An unreachable source keeps the cache.
  async refresh(): Promise<Item[]> {
    await this.ensureLoaded();
    let fresh: Item[];
    try {
      fresh = await this.connector.list();
    } catch (error) {
      this.logger.warn(`Refresh failed: ${describe(error)}`);
      this.updates.publish({ kind: 'error', message: error instanceof Error ? error.message : undefined });
      return this.sorted();
    }
    const seen = new Set<string>();
    let changed = false;
    for (const item of fresh) {
      seen.add(item.id);
      if (differs(this.cache.get(item.id), item)) {
        this.cache.set(item.id, item);
        this.updates.publish({ kind: 'item', item });
        changed = true;
      }
    }
    for (const id of [...this.cache.keys()]) {
      if (seen.has(id)) continue;
      this.cache.delete(id);
      this.updates.publish({ kind: 'removed', id });
      changed = true;
    }
    if (changed) await this.save();
    return this.sorted();
  }

  async move(id: string, from: string, to: string): Promise<Item> {
    await this.ensureLoaded();
    const lane = this.config.lanes.find((l) => l.id === to);
    if (!lane) throw new BacklogNotFoundError('lane');
    let item: Item;
    try {
      item = await this.connector.moveToLane(id, from, to);
    } catch (error) {
      if (error instanceof BacklogConflictError) await this.reload(id);
      throw error;
    }
    await this.put(item);
    if (lane.trigger) this.triggers.emit({ itemId: id, from, to, trigger: lane.trigger, at: new Date().toISOString() });
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
      this.logger.warn(`Could not reload item ${id}: ${describe(error)}`);
    }
  }

  private async put(item: Item): Promise<void> {
    this.cache.set(item.id, item);
    this.updates.publish({ kind: 'item', item });
    await this.save();
  }

  private save(): Promise<void> {
    return this.store.save([...this.cache.values()]);
  }

  private sorted(): Item[] {
    return [...this.cache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private ensureLoaded(): Promise<void> {
    this.loaded ??= this.store.load().then(
      (items) => { for (const item of items) this.cache.set(item.id, item); },
      (error: unknown) => { this.logger.warn(`Could not load the cache: ${describe(error)}`); },
    );
    return this.loaded;
  }
}

function differs(a: Item | undefined, b: Item): boolean {
  return !a || JSON.stringify(a) !== JSON.stringify(b);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
