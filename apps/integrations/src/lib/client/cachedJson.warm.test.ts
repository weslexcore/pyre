// Warming the cache ahead of an island: one request per URL however many
// hovers ask for it, a fresh entry is left alone, and a failed warm is
// nobody's problem but the island's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRESH_MS, invalidateJson, peekJson, primeJson, warmJson } from './cachedJson';

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const fetchMock = vi.fn<(input: string) => Promise<Response>>();

beforeEach(() => {
  invalidateJson();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T18:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('warmJson', () => {
  it('fetches once and leaves the body in the cache', async () => {
    fetchMock.mockResolvedValue(okResponse({ boards: [] }));
    await Promise.all([warmJson('/api/admin/boards'), warmJson('/api/admin/boards')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(peekJson('/api/admin/boards')).toEqual({ boards: [] });
  });

  it('is a no-op while the entry is fresh, and fetches again once it is not', async () => {
    fetchMock.mockResolvedValue(okResponse(1));
    await warmJson('/x');
    await warmJson('/x');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FRESH_MS + 1);
    await warmJson('/x');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('swallows a failed warm and caches nothing for it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    await expect(warmJson('/broken')).resolves.toBeUndefined();
    expect(peekJson('/broken')).toBeNull();
  });

  it('is dropped by invalidateJson along with the cache', async () => {
    primeJson('/api/admin/sops', { sops: [1] });
    expect(peekJson('/api/admin/sops')).toEqual({ sops: [1] });
    invalidateJson('/api/admin/sops');
    expect(peekJson('/api/admin/sops')).toBeNull();
  });
});
