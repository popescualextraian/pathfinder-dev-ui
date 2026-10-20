import { BacklogConfig } from '../../service/backlog-config';
import { BacklogConnector, FileLink, Item, ItemDraft, ItemPatch } from '../../service/backlog-connector';
import { BacklogConflictError, BacklogInvalidError, BacklogNotFoundError } from '../../service/backlog-errors';

/**
 * Items in memory, seeded from the config's `memory.items` (ids 1, 2, ...), lost at restart. For development and UI
 * tests only (see connector.factory.ts). Same contract as the GitLab connector: a move with a `from` that is not the
 * item's lane is a conflict, nothing can be created in the closed lane, an update never changes the lane.
 */
export class MemoryConnector implements BacklogConnector {
  private readonly items = new Map<string, Item>();
  private nextId = 1;
  private readonly defaultLane: string;
  private readonly closedLane?: string;

  constructor(config: BacklogConfig) {
    this.defaultLane = config.lanes.find((l) => l.default)?.id ?? config.lanes[0]?.id ?? '';
    this.closedLane = config.lanes.find((l) => l.gitlab?.state === 'closed')?.id;
    for (const seed of config.memory?.items ?? []) this.add({ title: seed.title, description: seed.description, lane: seed.lane });
  }

  async me(): Promise<string> {
    return 'local';
  }

  async list(): Promise<Item[]> {
    return [...this.items.values()].map(copy);
  }

  async get(id: string): Promise<Item> {
    return copy(this.find(id));
  }

  async moveToLane(id: string, from: string, to: string): Promise<Item> {
    const item = this.find(id);
    if (item.lane !== from) throw new BacklogConflictError();
    return this.save({ ...item, lane: to });
  }

  async getFileLinks(id: string): Promise<FileLink[]> {
    return structuredClone(this.find(id).fileLinks);
  }

  async setFileLinks(id: string, links: FileLink[]): Promise<FileLink[]> {
    this.save({ ...this.find(id), fileLinks: structuredClone(links) });
    return structuredClone(links);
  }

  async create(draft: ItemDraft): Promise<Item> {
    if (draft.lane !== undefined && draft.lane === this.closedLane) throw new BacklogInvalidError('Cannot create an item in a closed lane');
    return copy(this.add(draft));
  }

  async update(id: string, patch: ItemPatch): Promise<Item> {
    const item = this.find(id);
    return this.save({
      ...item,
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.assignees !== undefined && { assignees: [...patch.assignees] }),
    });
  }

  private add(draft: ItemDraft): Item {
    const id = String(this.nextId++);
    const item: Item = {
      id, title: draft.title, description: draft.description ?? '', lane: draft.lane ?? this.defaultLane,
      assignees: [], url: `memory://items/${id}`, fileLinks: [], updatedAt: new Date().toISOString(),
    };
    this.items.set(id, item);
    return item;
  }

  private find(id: string): Item {
    const item = this.items.get(id);
    if (!item) throw new BacklogNotFoundError();
    return item;
  }

  private save(item: Item): Item {
    const saved = { ...item, updatedAt: new Date().toISOString() };
    this.items.set(item.id, saved);
    return copy(saved);
  }
}

function copy(item: Item): Item {
  return structuredClone(item);
}
