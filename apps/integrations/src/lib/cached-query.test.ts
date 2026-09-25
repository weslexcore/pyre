import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedQuery } from './cached-query';

afterEach(() => {
  vi.useRealTimers();
});

describe('cachedQuery', () => {
  it('serves the cached value inside the TTL and reloads after it', async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValueOnce(['a']).mockResolvedValueOnce(['b']);
    const q = cachedQuery(load, 1000);
    expect(await q.get()).toEqual(['a']);
    expect(await q.get()).toEqual(['a']);
    vi.advanceTimersByTime(1001);
    expect(await q.get()).toEqual(['b']);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('serves the last good value when a reload fails', async () => {
    const load = vi.fn().mockResolvedValueOnce(['a']).mockResolvedValueOnce(null);
    const q = cachedQuery(load);
    await q.get();
    expect(await q.get(true)).toEqual(['a']);
  });

  it('returns null with nothing cached, and reloads after invalidate', async () => {
    const load = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(['x']);
    const q = cachedQuery(load);
    expect(await q.get()).toBeNull();
    q.invalidate();
    expect(await q.get()).toEqual(['x']);
  });
});
