// Client-side stale-while-revalidate cache for the /admin islands.
//
// Every admin page is a thin .astro shell around a `client:load` React island
// that fetches its own JSON on mount. Before this hook, each navigation meant
// an empty island, a spinner, and a fresh round trip — even when flipping
// back to a page you had open seconds ago.
//
// The cache lives in module scope, which survives ClientRouter navigations:
// the router swaps the document without re-evaluating already-loaded modules,
// so returning to a page paints the last-known data immediately and
// revalidates behind it. A hard reload starts cold, which is usually what we
// want — this is a perceived-latency cache, never a source of truth.
//
// A page that is kept open all shift and refreshed when something looks
// stuck (Check Ins) can opt in to `persist`: its last response is mirrored
// into localStorage too, so a reload paints it at once and revalidates
// behind it, and a Momence outage leaves the last-known floor on screen
// rather than nothing. The mirror keeps its own, longer, age limit.
//
// The /api/admin routes stay the security boundary. Entries live only in the
// visitor's own browser and are keyed by full URL, so two different queries
// can never collide.

import { useCallback, useEffect, useRef, useState } from 'react';

interface Entry {
  data: unknown;
  /** Epoch ms of the last successful fetch, for TTL eviction. */
  at: number;
}

const cache = new Map<string, Entry>();

/** Cached data older than this is dropped rather than painted. */
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/** Pages key by query string (week, window, filters) — keep the map bounded. */
const MAX_ENTRIES = 50;

/** localStorage keys of persisted entries: the prefix plus the URL. */
const STORAGE_PREFIX = 'pyre-json:';

interface StoredEntry extends Entry {
  /** How long the entry stays good for, so a sweep can drop it unread. */
  ttl: number;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Storage access can throw (privacy settings); the page works without it.
    return null;
  }
}

/** The persisted entry for `key` (a URL), or null when none is fresh enough. */
export function readPersistedJson<T>(key: string, maxAgeMs: number): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<StoredEntry>;
    if (typeof entry.at !== 'number' || entry.data === undefined) return null;
    if (Date.now() - entry.at > maxAgeMs) {
      store.removeItem(STORAGE_PREFIX + key);
      return null;
    }
    return entry.data as T;
  } catch {
    return null;
  }
}

/** Drop every persisted entry that has outlived its own age limit. */
function sweepStored(store: Storage): void {
  const stale: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    try {
      const entry = JSON.parse(store.getItem(key) ?? '') as Partial<StoredEntry>;
      if (typeof entry.at !== 'number' || Date.now() - entry.at > (entry.ttl ?? 0)) {
        stale.push(key);
      }
    } catch {
      stale.push(key);
    }
  }
  for (const key of stale) store.removeItem(key);
}

/** Persist `data` for `key` (a URL), good for `ttl` ms, dropping expired entries. */
export function writePersistedJson(key: string, data: unknown, ttl: number): void {
  const store = storage();
  if (!store) return;
  try {
    sweepStored(store);
    const entry: StoredEntry = { data, at: Date.now(), ttl };
    store.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota or private mode — the in-memory cache still works.
  }
}

function removeStored(prefix: string): void {
  const store = storage();
  if (!store) return;
  try {
    const gone: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(STORAGE_PREFIX + prefix)) gone.push(key);
    }
    for (const key of gone) store.removeItem(key);
  } catch {
    // Nothing to drop.
  }
}

function readCache<T>(key: string, maxAgeMs: number): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > maxAgeMs) {
    cache.delete(key);
    return null;
  }
  return hit.data as T;
}

function writeCache(key: string, data: unknown): void {
  // Map iterates in insertion order, so re-inserting keeps the freshest keys
  // last and lets us evict the oldest first.
  cache.delete(key);
  cache.set(key, { data, at: Date.now() });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Drop cached entries so the next read refetches. Call after a mutation that
 * invalidates another page's data — `invalidateJson()` clears everything,
 * `invalidateJson('/api/admin/shifts')` clears by URL prefix.
 */
export function invalidateJson(prefix?: string): void {
  if (prefix === undefined) {
    cache.clear();
    removeStored('');
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  removeStored(prefix);
}

export interface CachedJson<T> {
  data: T | null;
  error: string | null;
  /** True only when there is nothing to paint yet — this drives the spinner. */
  loading: boolean;
  /** True while revalidating with stale data already on screen. */
  refreshing: boolean;
  /** Refetch, bypassing the cache. Resolves once state has settled. */
  reload: () => Promise<void>;
  /**
   * Replace the local data and write it through to the cache, so an
   * optimistic update survives navigating away and back.
   */
  setData: (next: T | null | ((prev: T | null) => T | null)) => void;
}

export interface CachedJsonOptions {
  maxAgeMs?: number;
  /**
   * Mirror the last response into localStorage, so a hard reload paints it
   * and revalidates behind it. Entries older than `persistMaxAgeMs` (default
   * `maxAgeMs`) are dropped rather than painted.
   */
  persist?: boolean;
  persistMaxAgeMs?: number;
}

/**
 * Fetch JSON from `url`, painting cached data immediately when it is fresh
 * enough. Pass `url: null` to stand down (renders as not-loading, keeping
 * whatever data is already held) — for gated islands or incomplete forms.
 */
export function useCachedJson<T>(
  url: string | null,
  options: CachedJsonOptions = {}
): CachedJson<T> {
  const { maxAgeMs = DEFAULT_MAX_AGE_MS, persist = false, persistMaxAgeMs = maxAgeMs } = options;

  const [data, setDataState] = useState<T | null>(() => (url ? readCache<T>(url, maxAgeMs) : null));
  const [error, setError] = useState<string | null>(null);
  // Start pending only when the first paint has nothing to show.
  const [pending, setPending] = useState<boolean>(() =>
    url ? readCache<T>(url, maxAgeMs) === null : false
  );

  // Guards against out-of-order responses: only the newest request may write.
  const requestId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Lets a settled response check that the island still wants this URL.
  const urlRef = useRef(url);
  urlRef.current = url;

  const run = useCallback(
    async (target: string, force: boolean): Promise<void> => {
      if (force) {
        setPending(true);
      } else {
        const cached =
          readCache<T>(target, maxAgeMs) ??
          (persist ? readPersistedJson<T>(target, persistMaxAgeMs) : null);
        if (cached !== null) setDataState(cached);
        setPending(true);
      }

      const id = ++requestId.current;
      setError(null);
      try {
        const res = await fetch(target, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as T;
        writeCache(target, body);
        if (persist) writePersistedJson(target, body, persistMaxAgeMs);
        // A newer request, an unmount, or a key change superseded this one.
        if (id !== requestId.current || !mounted.current || urlRef.current !== target) return;
        setDataState(body);
      } catch (e) {
        if (id !== requestId.current || !mounted.current || urlRef.current !== target) return;
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (id === requestId.current && mounted.current) setPending(false);
      }
    },
    [maxAgeMs, persist, persistMaxAgeMs]
  );

  useEffect(() => {
    if (!url) {
      setPending(false);
      return;
    }
    void run(url, false);
  }, [url, run]);

  const reload = useCallback(async (): Promise<void> => {
    const target = urlRef.current;
    if (!target) return;
    await run(target, true);
  }, [run]);

  const setData = useCallback(
    (next: T | null | ((prev: T | null) => T | null)) => {
      setDataState((prev) => {
        const resolved =
          typeof next === 'function' ? (next as (p: T | null) => T | null)(prev) : next;
        const target = urlRef.current;
        if (target) {
          if (resolved === null) {
            cache.delete(target);
            if (persist) removeStored(target);
          } else {
            writeCache(target, resolved);
            if (persist) writePersistedJson(target, resolved, persistMaxAgeMs);
          }
        }
        return resolved;
      });
    },
    [persist, persistMaxAgeMs]
  );

  return {
    data,
    error,
    loading: pending && data === null,
    refreshing: pending && data !== null,
    reload,
    setData,
  };
}
