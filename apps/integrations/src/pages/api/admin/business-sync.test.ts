// The manual "Sync now" route. The lock is the part worth pinning: report-run
// creation spends a 100/day Momence budget, so two presses must not become two
// sweeps.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdmin = vi.fn();
const runBusinessReportSync = vi.fn();
const runActivityMetricsSync = vi.fn();
const getRedis = vi.fn();

vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: (c: unknown) => requireAdmin(c),
  assertSameOrigin: () => null,
}));
vi.mock('@/lib/reports/sync', () => ({
  runBusinessReportSync: (ctx: unknown, opts: unknown) => runBusinessReportSync(ctx, opts),
}));
vi.mock('@/lib/reports/activity', () => ({
  runActivityMetricsSync: (ctx: unknown, opts: unknown) => runActivityMetricsSync(ctx, opts),
}));
vi.mock('@pyre/webhook-core', () => ({ getRedis: () => getRedis() }));

const { POST } = await import('./business-sync');

const reportSummary = (over: Record<string, unknown> = {}) => ({
  created: 1,
  completed: 1,
  failedTypes: [],
  metricsUpserted: 12,
  resumed: false,
  ...over,
});

const activitySummary = (over: Record<string, unknown> = {}) => ({
  weeksProcessed: 3,
  sessionsScanned: 40,
  bookingsScanned: 120,
  membersClassified: 88,
  metricsUpserted: 30,
  pendingWeeks: 0,
  pendingMembers: 0,
  resumed: false,
  ...over,
});

/** Redis double whose `set` honors nx, so the lock behaves like the real one. */
function fakeRedis(held = false) {
  const store = new Map<string, unknown>();
  if (held) store.set('business-sync:manual', 'earlier');
  return {
    store,
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
}

const post = (headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  POST({
    cookies: {},
    request: new Request('https://x.test/api/admin/business-sync', { method: 'POST', headers }),
    // biome-ignore lint/suspicious/noExplicitAny: only the two fields the route reads matter
  } as any);

describe('POST /api/admin/business-sync', () => {
  beforeEach(() => {
    requireAdmin.mockReset().mockResolvedValue({ user: {}, access: { isAdmin: true } });
    runBusinessReportSync.mockReset().mockResolvedValue(reportSummary());
    runActivityMetricsSync.mockReset().mockResolvedValue(activitySummary());
    getRedis.mockReset();
  });

  it('refuses a request that is not JSON, so a cross-origin form cannot reach it', async () => {
    getRedis.mockReturnValue(fakeRedis());
    const res = await post({ 'content-type': 'text/plain' });
    expect(res.status).toBe(415);
    expect(runBusinessReportSync).not.toHaveBeenCalled();
  });

  it('passes the admin gate through untouched', async () => {
    requireAdmin.mockResolvedValue(new Response('nope', { status: 403 }));
    const res = await post();
    expect(res.status).toBe(403);
    expect(runBusinessReportSync).not.toHaveBeenCalled();
  });

  it('runs both jobs forced, so the daily gate cannot skip the press', async () => {
    getRedis.mockReturnValue(fakeRedis());
    const res = await post();
    expect(res.status).toBe(200);
    expect(runBusinessReportSync).toHaveBeenCalledWith(expect.anything(), { force: true });
    expect(runActivityMetricsSync).toHaveBeenCalledWith(expect.anything(), { force: true });
  });

  it('reports what happened in one line', async () => {
    getRedis.mockReturnValue(fakeRedis());
    const body = await (await post()).json();
    expect(body.message).toContain('revenue updated');
    expect(body.message).toContain('88 members');
    expect(body.message).toContain('3 weeks');
    expect(body.pending).toBe(false);
  });

  it('names what is still pending and invites another press', async () => {
    getRedis.mockReturnValue(fakeRedis());
    runActivityMetricsSync.mockResolvedValue(
      activitySummary({ outOfTime: true, pendingWeeks: 4, weeksProcessed: 1 })
    );
    const body = await (await post()).json();
    expect(body.pending).toBe(true);
    expect(body.message).toContain('4 weeks');
    expect(body.message).toContain('press again');
  });

  it('turns a second press away while the first is still holding the lock', async () => {
    getRedis.mockReturnValue(fakeRedis(true));
    const res = await post();
    expect(res.status).toBe(429);
    expect(runBusinessReportSync).not.toHaveBeenCalled();
  });

  it('frees the lock when a run throws, so a failure is retryable at once', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);
    runBusinessReportSync.mockRejectedValue(new Error('Momence 500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await post();

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'Momence 500' });
    expect(redis.store.has('business-sync:manual')).toBe(false);
  });

  it('says so rather than half-running when Redis is unavailable', async () => {
    getRedis.mockReturnValue(null);
    const res = await post();
    expect(res.status).toBe(503);
    expect(runBusinessReportSync).not.toHaveBeenCalled();
  });
});
