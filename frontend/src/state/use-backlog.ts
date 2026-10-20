import { useCallback, useEffect, useRef, useState } from 'react';
import type { BacklogItem, FileLink, ItemDraft, ItemPatch, Lane } from '../api/models';
import { createItem, getItems, getLanes, moveItem, refreshBacklog, setFileLinks, updateItem } from '../api/backlog-api';
import { ApiError } from '../api/http';
import { openBacklogStream } from '../api/backlog-stream';

const newestFirst = (a: BacklogItem, b: BacklogItem) =>
  a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Inserts or replaces an item (by id) unless the list holds a newer copy; keeps updatedAt-descending order. */
export function upsertItem(list: BacklogItem[], item: BacklogItem): BacklogItem[] {
  const current = list.find((i) => i.id === item.id);
  if (current && current.updatedAt > item.updatedAt) return list;
  return [...list.filter((i) => i.id !== item.id), item].sort(newestFirst);
}

/** Loads the lanes once; when the backlog is on, loads the items, keeps them current from the stream and reloads on every (re)connect. */
export function useBacklog() {
  const [enabled, setEnabled] = useState(false);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [me, setMe] = useState('');
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestLoad = useRef(0);
  // Changes seen on the stream while a load runs: the (older) GET must not undo them.
  const touched = useRef(new Map<string, BacklogItem | null>());
  const itemsRef = useRef<BacklogItem[]>([]);
  itemsRef.current = items;

  const load = useCallback((keepError = false) => {
    const seq = ++latestLoad.current;
    touched.current = new Map();
    return getItems()
      .then((list) => {
        if (seq !== latestLoad.current) return;
        const seen = touched.current;
        setItems((current) => {
          let merged = list.map((t) => {
            const mine = current.find((c) => c.id === t.id);
            return mine && mine.updatedAt > t.updatedAt ? mine : t;
          });
          for (const [id, item] of seen) {
            merged = merged.filter((t) => t.id !== id);
            if (item) merged.push(item);
          }
          return merged.sort(newestFirst);
        });
        if (!keepError) setError(null);
      })
      .catch((e: unknown) => {
        if (seq === latestLoad.current) setError(message(e));
      })
      .finally(() => {
        if (seq === latestLoad.current) setLoading(false);
      });
  }, []);

  const applyItem = useCallback((item: BacklogItem) => {
    touched.current.set(item.id, item);
    setItems((list) => upsertItem(list, item));
  }, []);

  const removeItem = useCallback((id: string) => {
    touched.current.set(id, null);
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    getLanes()
      .then((response) => {
        if (cancelled) return;
        if (!response) {
          setLoading(false);
          return;
        }
        setLanes(response.lanes);
        setMe(response.me);
        setEnabled(true);
        stop = openBacklogStream({
          // Every (re)connect reloads; a newer load supersedes an older one.
          onOpen: () => void load(),
          onItem: applyItem,
          onRemoved: removeItem,
          onServerError: setError,
        });
        void load();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(message(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [load, applyItem, removeItem]);

  const move = useCallback(
    async (id: string, to: string) => {
      const before = itemsRef.current.find((i) => i.id === id);
      if (!before || before.lane === to) return;
      const from = before.lane;
      setItems((list) => list.map((i) => (i.id === id ? { ...i, lane: to } : i)));
      try {
        applyItem(await moveItem(id, from, to));
        setError(null);
      } catch (e) {
        // Snap back, unless the stream already moved the card elsewhere meanwhile.
        setItems((list) => list.map((i) => (i.id === id && i.lane === to ? { ...i, lane: from } : i)));
        setError(message(e));
        if (e instanceof ApiError && e.status === 409) void load(true);
      }
    },
    [applyItem, load],
  );

  const refresh = useCallback(async () => {
    try {
      const list = await refreshBacklog();
      latestLoad.current++; // supersede a running load
      touched.current = new Map();
      setItems([...list].sort(newestFirst));
      setError(null);
      setLoading(false); // the superseded load no longer clears it
    } catch (e) {
      setError(message(e));
    }
  }, []);

  /** Saves the file links of an item; the server's stored list replaces the local one. Rejects on failure. */
  const saveFileLinks = useCallback(async (id: string, links: FileLink[]) => {
    const saved = await setFileLinks(id, links);
    setItems((list) => list.map((i) => (i.id === id ? { ...i, fileLinks: saved } : i)));
  }, []);

  /** Creates an item; the returned item joins the board. Rejects on failure (the dialog shows it). */
  const create = useCallback(
    async (draft: ItemDraft) => {
      const created = await createItem(draft);
      applyItem(created);
      return created;
    },
    [applyItem],
  );

  /** Edits title, description or assignees; the returned item replaces the local one. Rejects on failure. */
  const update = useCallback(
    async (id: string, patch: ItemPatch) => {
      const updated = await updateItem(id, patch);
      applyItem(updated);
      return updated;
    },
    [applyItem],
  );

  return { enabled, loading, error, lanes, me, items, move, refresh, saveFileLinks, create, update };
}
