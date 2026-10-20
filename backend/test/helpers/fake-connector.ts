import { BacklogConnector, FileLink, Item, ItemDraft, ItemPatch } from '../../src/backlog/service/backlog-connector';
import { BacklogConflictError, BacklogInvalidError, BacklogNotFoundError } from '../../src/backlog/service/backlog-errors';

// In-memory BacklogConnector. Set `failure` to make every call reject with it.
export class FakeConnector implements BacklogConnector {
  items = new Map<string, Item>();
  failure?: Error;
  user = 'me';
  creates: ItemDraft[] = [];
  updates: Array<{ id: string; patch: ItemPatch }> = [];
  defaultLane = 'todo';
  moves: Array<{ id: string; from: string; to: string }> = [];

  constructor(items: Item[] = []) {
    for (const i of items) this.items.set(i.id, i);
  }

  private check(): void {
    if (this.failure) throw this.failure;
  }

  private find(id: string): Item {
    const item = this.items.get(id);
    if (!item) throw new BacklogNotFoundError();
    return item;
  }

  async me(): Promise<string> {
    this.check();
    return this.user;
  }

  async list(): Promise<Item[]> {
    this.check();
    return [...this.items.values()];
  }

  async get(id: string): Promise<Item> {
    this.check();
    return this.find(id);
  }

  async moveToLane(id: string, from: string, to: string): Promise<Item> {
    this.check();
    const item = this.find(id);
    if (item.lane !== from) throw new BacklogConflictError();
    this.moves.push({ id, from, to });
    const moved = { ...item, lane: to, updatedAt: new Date().toISOString() };
    this.items.set(id, moved);
    return moved;
  }

  async create(draft: ItemDraft): Promise<Item> {
    this.check();
    if (draft.lane === 'closed-lane') throw new BacklogInvalidError('Cannot create an item in a closed lane');
    this.creates.push(draft);
    const id = String(100 + this.creates.length);
    const item: Item = {
      id, title: draft.title, description: draft.description ?? '', lane: draft.lane ?? this.defaultLane,
      assignees: [], url: `u/${id}`, fileLinks: [], updatedAt: new Date().toISOString(),
    };
    this.items.set(id, item);
    return item;
  }

  async update(id: string, patch: ItemPatch): Promise<Item> {
    this.check();
    const item = this.find(id);
    this.updates.push({ id, patch });
    const updated = { ...item, ...patch, updatedAt: new Date().toISOString() };
    this.items.set(id, updated);
    return updated;
  }

  async getFileLinks(id: string): Promise<FileLink[]> {
    this.check();
    return this.find(id).fileLinks;
  }

  async setFileLinks(id: string, links: FileLink[]): Promise<FileLink[]> {
    this.check();
    this.items.set(id, { ...this.find(id), fileLinks: links });
    return links;
  }
}
