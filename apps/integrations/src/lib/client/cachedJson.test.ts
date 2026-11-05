// The persisted half of the cache: entries written for a page that opts in
// come back until their own age limit, expired ones are swept, and
// invalidating by URL prefix drops them along with the in-memory copies.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateJson, readPersistedJson, writePersistedJson } from './cachedJson';

class MemoryStorage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
  clear() {
    this.items.clear();
  }
}

const store = new MemoryStorage();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('window', { localStorage: store });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T18:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('persisted entries', () => {
  it('come back while fresh and are dropped once past their age limit', () => {
    writePersistedJson('/api/admin/guest-checkins', { guests: [1] }, 60_000);
    expect(readPersistedJson('/api/admin/guest-checkins', 60_000)).toEqual({ guests: [1] });

    vi.advanceTimersByTime(61_000);
    expect(readPersistedJson('/api/admin/guest-checkins', 60_000)).toBeNull();
    expect(store.length).toBe(0);
  });

  it('are keyed by full URL, so two views never collide', () => {
    writePersistedJson('/x', 'floor', 60_000);
    writePersistedJson('/x?view=day&date=2026-11-05', 'day', 60_000);
    expect(readPersistedJson('/x', 60_000)).toBe('floor');
    expect(readPersistedJson('/x?view=day&date=2026-11-05', 60_000)).toBe('day');
  });

  it('sweeps entries that outlived their own ttl on the next write', () => {
    writePersistedJson('/short', 1, 1_000);
    writePersistedJson('/long', 2, 60_000);
    vi.advanceTimersByTime(2_000);
    writePersistedJson('/new', 3, 60_000);
    expect(store.getItem('pyre-json:/short')).toBeNull();
    expect(readPersistedJson('/long', 60_000)).toBe(2);
    expect(readPersistedJson('/new', 60_000)).toBe(3);
  });

  it('ignore garbage left in storage', () => {
    store.setItem('pyre-json:/bad', 'not json');
    expect(readPersistedJson('/bad', 60_000)).toBeNull();
  });

  it('are dropped by invalidateJson, by prefix or altogether', () => {
    writePersistedJson('/api/admin/guest-checkins', 1, 60_000);
    writePersistedJson('/api/admin/guest-checkins?view=next', 2, 60_000);
    writePersistedJson('/api/admin/shifts', 3, 60_000);
    invalidateJson('/api/admin/guest-checkins');
    expect(readPersistedJson('/api/admin/guest-checkins', 60_000)).toBeNull();
    expect(readPersistedJson('/api/admin/guest-checkins?view=next', 60_000)).toBeNull();
    expect(readPersistedJson('/api/admin/shifts', 60_000)).toBe(3);
    invalidateJson();
    expect(store.length).toBe(0);
  });

  it('do nothing without a window', () => {
    vi.stubGlobal('window', undefined);
    writePersistedJson('/x', 1, 60_000);
    expect(readPersistedJson('/x', 60_000)).toBeNull();
  });
});
