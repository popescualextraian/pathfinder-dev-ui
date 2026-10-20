import { Item } from './backlog-connector';

// Injection token of the cache storage (implemented by the repository layer).
export const BACKLOG_STORE = Symbol('BACKLOG_STORE');

export interface BacklogStore {
  load(): Promise<Item[]>;
  save(items: Item[]): Promise<void>;
}
