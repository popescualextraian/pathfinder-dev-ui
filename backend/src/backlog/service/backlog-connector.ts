// Injection token of the backlog connector.
export const BACKLOG_CONNECTOR = Symbol('BACKLOG_CONNECTOR');

export interface FileLink {
  repo: string;
  path: string;
  ref?: string;
  note?: string;
}

export interface Item {
  id: string;
  title: string;
  description: string;
  lane: string;
  assignees: string[];
  url: string;
  fileLinks: FileLink[];
  updatedAt: string;
}

export interface ItemDraft {
  title: string;
  description?: string;
  lane?: string;
}

export type ItemPatch = Partial<Pick<ItemDraft, 'title' | 'description'>> & { assignees?: string[] };

export interface BacklogConnector {
  me(): Promise<string>;
  list(): Promise<Item[]>;
  get(id: string): Promise<Item>;
  // BacklogConflictError when the source's lane is not `from`.
  moveToLane(id: string, from: string, to: string): Promise<Item>;
  getFileLinks(id: string): Promise<FileLink[]>;
  setFileLinks(id: string, links: FileLink[]): Promise<FileLink[]>;
  // Milestone 2 (a later task makes them required).
  create?(draft: ItemDraft): Promise<Item>;
  update?(id: string, patch: ItemPatch): Promise<Item>;
}
