import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MomenceEvent, MomenceTeacher } from '@/lib/momence-types';

// The module under test keeps per-instance state (memo, in-flight refresh), so
// every test gets a fresh import.
const store = new Map<string, unknown>();
const redis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
    return 'OK';
  }),
};
const createRedis = vi.fn((_config: unknown) => redis);
const waitUntil = vi.fn();
const fetchMomenceTeachers = vi.fn<() => Promise<MomenceTeacher[]>>();

vi.mock('@pyre/webhook-core', () => ({ createRedis }));
vi.mock('@vercel/functions', () => ({ waitUntil }));
vi.mock('@/lib/momence', () => ({ fetchMomenceTeachers }));

const SNAPSHOT_KEY = 'events:momence:last-good';
const NOW = new Date('2026-09-10T12:00:00Z');

function event(id: number): MomenceEvent {
  return { id, title: `Session ${id}` } as MomenceEvent;
}

function teacher(id: number): MomenceTeacher {
  return {
    id,
    firstName: 'T',
    lastName: String(id),
    bio: null,
    profileImage: null,
    isDeleted: false,
  };
}

function seedSnapshot(ageMs: number, extra: Partial<{ teachers: MomenceTeacher[] }> = {}) {
  store.set(SNAPSHOT_KEY, {
    events: [event(1)],
    teachers: [teacher(1)],
    fetchedAt: new Date(NOW.getTime() - ageMs).toISOString(),
    ...extra,
  });
}

/** Momence answers with `events`, or fails when given an Error. */
function momenceResponds(result: MomenceEvent[] | Error) {
  const fetchMock = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function load() {
  const mod = await import('./momence-cache');
  return mod.loadMomenceCalendar;
}

/** Let every queued background promise settle. */
async function settle() {
  for (const call of waitUntil.mock.calls) await call[0];
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('MOMENCE_HOST_ID', 'host');
  vi.stubEnv('MOMENCE_API_TOKEN', 'token');
  store.clear();
  redis.get.mockClear();
  redis.set.mockClear();
  waitUntil.mockClear();
  fetchMomenceTeachers.mockReset().mockResolvedValue([teacher(2)]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('loadMomenceCalendar', () => {
  it('serves a fresh snapshot without touching Momence', async () => {
    seedSnapshot(10_000);
    const fetchMock = momenceResponds([event(9)]);

    const calendar = await (await load())();

    expect(calendar?.events).toEqual([event(1)]);
    expect(calendar?.stale).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('serves a recent-but-stale snapshot immediately and refreshes it behind the response', async () => {
    seedSnapshot(2 * 60_000);
    const fetchMock = momenceResponds([event(9)]);
    const loadCalendar = await load();

    const served = await loadCalendar();

    // The visitor got the snapshot, not the fetch.
    expect(served?.events).toEqual([event(1)]);
    expect(served?.stale).toBe(false);
    expect(waitUntil).toHaveBeenCalledTimes(1);

    await settle();

    // The refresh reached Momence, rewrote the shared snapshot, and the next
    // request on this instance gets the fresh copy from memory.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect((store.get(SNAPSHOT_KEY) as { events: MomenceEvent[] }).events).toEqual([event(9)]);
    redis.get.mockClear();
    const next = await loadCalendar();
    expect(next?.events).toEqual([event(9)]);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('keeps serving the snapshot when the background refresh fails', async () => {
    seedSnapshot(2 * 60_000);
    momenceResponds(new Error('gateway timeout'));
    const loadCalendar = await load();

    const served = await loadCalendar();
    await settle();

    expect(served?.events).toEqual([event(1)]);
    expect((store.get(SNAPSHOT_KEY) as { events: MomenceEvent[] }).events).toEqual([event(1)]);
  });

  it('shares one background refresh across a burst of requests', async () => {
    seedSnapshot(2 * 60_000);
    const fetchMock = momenceResponds([event(9)]);
    const loadCalendar = await load();

    await loadCalendar();
    // Past the memo, so the second request re-reads the snapshot and would
    // otherwise start its own refresh.
    vi.setSystemTime(new Date(NOW.getTime() + 31_000));
    await loadCalendar();

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waits for Momence when the snapshot is too old to show', async () => {
    seedSnapshot(10 * 60_000);
    const fetchMock = momenceResponds([event(9)]);

    const calendar = await (await load())();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calendar?.events).toEqual([event(9)]);
    expect(calendar?.stale).toBe(false);
    expect(waitUntil).not.toHaveBeenCalled();
    expect((store.get(SNAPSHOT_KEY) as { events: MomenceEvent[] }).events).toEqual([event(9)]);
  });

  it('falls back to an old snapshot, marked stale, when Momence is down', async () => {
    seedSnapshot(10 * 60_000);
    momenceResponds(new Error('gateway timeout'));

    const calendar = await (await load())();

    expect(calendar?.events).toEqual([event(1)]);
    expect(calendar?.stale).toBe(true);
  });

  it('resolves to null when Momence is down and nothing is cached', async () => {
    momenceResponds(new Error('gateway timeout'));

    expect(await (await load())()).toBeNull();
  });

  it('treats a Redis failure as a cache miss and goes to Momence', async () => {
    redis.get.mockRejectedValueOnce(new Error('upstash timeout'));
    const fetchMock = momenceResponds([event(9)]);

    const calendar = await (await load())();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calendar?.events).toEqual([event(9)]);
  });

  it('keeps the last good teacher roster when the roster fetch flakes', async () => {
    seedSnapshot(10 * 60_000);
    fetchMomenceTeachers.mockResolvedValue([]);
    momenceResponds([event(9)]);

    const calendar = await (await load())();

    expect(calendar?.teachers).toEqual([teacher(1)]);
  });

  it('bounds every Redis call with a deadline and a single retry', async () => {
    seedSnapshot(10_000);
    momenceResponds([event(9)]);

    await (await load())();

    const config = createRedis.mock.calls[0]?.[0] as {
      signal: () => AbortSignal;
      retry: { retries: number };
    };
    expect(config.retry.retries).toBe(1);
    expect(config.signal()).toBeInstanceOf(AbortSignal);
  });
});
