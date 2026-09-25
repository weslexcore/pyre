// A brief in-process cache for a small table read on nearly every request
// (staff roster, partners, referral tiers, settings, the email gate).
//
// The loader returns null when the read failed or storage is down; the cache
// then serves the last good value, since a stale roster or registry beats
// treating an outage as "empty". invalidate() only clears the lambda instance
// that handled the mutation — other warm instances serve stale rows for up to
// ttlMs.

export interface CachedQuery<T> {
  /** The cached value, reloading once it is older than the TTL (or on force). */
  get(force?: boolean): Promise<T | null>;
  invalidate(): void;
}

export const DEFAULT_CACHE_TTL_MS = 30_000;

export function cachedQuery<T>(
  load: () => Promise<T | null>,
  ttlMs = DEFAULT_CACHE_TTL_MS
): CachedQuery<T> {
  let cache: { value: T; at: number } | null = null;
  return {
    async get(force = false) {
      if (!force && cache && Date.now() - cache.at < ttlMs) return cache.value;
      const value = await load();
      if (value === null) return cache?.value ?? null;
      cache = { value, at: Date.now() };
      return value;
    },
    invalidate() {
      cache = null;
    },
  };
}
