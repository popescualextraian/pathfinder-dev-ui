import type { BacklogItem, FileLink, ItemDraft, ItemPatch, LanesResponse } from './models';
import { ApiError, postJson, request } from './http';

const itemUrl = (id: string) => `/api/backlog/items/${encodeURIComponent(id)}`;

/** Null when the backlog is off (404). */
export async function getLanes(): Promise<LanesResponse | null> {
  try {
    return await request<LanesResponse>('/api/backlog/lanes');
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const getItems = () => request<BacklogItem[]>('/api/backlog/items');
export const createItem = (draft: ItemDraft) => postJson<BacklogItem>('/api/backlog/items', draft);
export const updateItem = (id: string, patch: ItemPatch) =>
  request<BacklogItem>(itemUrl(id), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
export const moveItem = (id: string, from: string, to: string) =>
  postJson<BacklogItem>(`${itemUrl(id)}/move`, { from, to });
export const setFileLinks = (id: string, links: FileLink[]) =>
  request<FileLink[]>(`${itemUrl(id)}/file-links`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ links }),
  });
export const refreshBacklog = () => postJson<BacklogItem[]>('/api/backlog/refresh');
