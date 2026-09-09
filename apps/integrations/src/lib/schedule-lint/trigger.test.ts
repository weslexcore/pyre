import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const publishJSON = vi.fn();
const ClientCtor = vi.fn();

const store = new Map<string, unknown>();
const fakeRedis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
    return 'OK';
  }),
  del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
};
let redisAvailable = true;

vi.mock('@upstash/qstash', () => ({
  Client: class {
    constructor(opts: unknown) {
      ClientCtor(opts);
    }
    publishJSON = publishJSON;
  },
}));
vi.mock('@pyre/webhook-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pyre/webhook-core')>()),
  getRedis: () => (redisAvailable ? fakeRedis : null),
}));

const { DEBOUNCE_SECONDS, DIRTY_KEY, lintRunUrl, requestLintRun } = await import('./trigger');

const NOW = new Date('2026-09-14T12:00:00Z');

describe('requestLintRun', () => {
  beforeEach(() => {
    store.clear();
    redisAvailable = true;
    publishJSON.mockReset().mockResolvedValue({ messageId: 'msg_1' });
    ClientCtor.mockReset();
    vi.stubEnv('QSTASH_TOKEN', 'qs_token');
    vi.stubEnv('CRON_SECRET', 'cron_secret');
    vi.stubEnv('PUBLIC_EMAIL_ASSET_BASE', 'https://integrations.pyre.test/assets');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes one delayed, deduplicated call to the forced tick', async () => {
    const outcome = await requestLintRun({ reason: 'session-created', sessionId: 42 }, NOW);
    expect(outcome).toEqual({ via: 'qstash', messageId: 'msg_1' });
    expect(ClientCtor).toHaveBeenCalledWith({ token: 'qs_token' });
    expect(publishJSON).toHaveBeenCalledTimes(1);
    expect(publishJSON.mock.calls[0][0]).toEqual({
      url: 'https://integrations.pyre.test/api/cron/tick?job=schedule-lint&force=1',
      body: { reason: 'session-created', sessionId: 42, at: NOW.toISOString() },
      delay: DEBOUNCE_SECONDS,
      deduplicationId: `schedule-lint:${Math.floor(NOW.getTime() / (DEBOUNCE_SECONDS * 1000))}`,
      headers: { Authorization: 'Bearer cron_secret' },
    });
    expect(store.size).toBe(0);
  });

  it('gives every event in the same ten-minute bucket the same deduplication id', async () => {
    await requestLintRun({ reason: 'session-created' }, NOW);
    await requestLintRun({ reason: 'session-updated' }, new Date(NOW.getTime() + 4 * 60_000));
    await requestLintRun({ reason: 'session-created' }, new Date(NOW.getTime() + 11 * 60_000));
    const ids = publishJSON.mock.calls.map(([req]) => req.deduplicationId as string);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('falls back to the dirty flag without a QStash token', async () => {
    vi.stubEnv('QSTASH_TOKEN', '');
    const outcome = await requestLintRun({ reason: 'session-created', sessionId: 7 }, NOW);
    expect(outcome).toEqual({ via: 'dirty-flag' });
    expect(publishJSON).not.toHaveBeenCalled();
    expect(store.get(DIRTY_KEY)).toEqual({
      reason: 'session-created',
      sessionId: 7,
      at: NOW.toISOString(),
    });
  });

  it('will not publish an unauthenticated tick call', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const outcome = await requestLintRun({ reason: 'session-created' }, NOW);
    expect(outcome).toEqual({ via: 'dirty-flag' });
    expect(publishJSON).not.toHaveBeenCalled();
  });

  it('reports when it has no way to schedule a run at all', async () => {
    vi.stubEnv('QSTASH_TOKEN', '');
    redisAvailable = false;
    expect(await requestLintRun({ reason: 'session-created' }, NOW)).toEqual({
      via: 'none',
      reason: 'qstash-and-redis-missing',
    });
  });

  it('defaults the tick origin to the production deployment', async () => {
    vi.stubEnv('PUBLIC_EMAIL_ASSET_BASE', '');
    expect(lintRunUrl()).toBe(
      'https://pyre-integrations.vercel.app/api/cron/tick?job=schedule-lint&force=1'
    );
  });
});
