// The review route's guards: the gate, JSON-only, validated ids, and the
// "already closed" answers — the parts that keep a stale tab from cancelling
// sessions someone else already decided about.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdmin = vi.fn();
const getDb = vi.fn();
const findReview = vi.fn();
const findPendingReview = vi.fn();
const listReviewHistory = vi.fn();
const lastCheckedAt = vi.fn();
const refreshReview = vi.fn();
const applyResolution = vi.fn();
const cancelSelectedSessions = vi.fn();

vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: (c: unknown) => requireAdmin(c),
  assertSameOrigin: () => null,
}));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));
vi.mock('@/lib/momence/host-api', () => ({ cancelRouteStatus: () => 'unknown' }));
vi.mock('@/lib/session-conflicts/store', () => ({
  findReview: (db: unknown, id: string) => findReview(db, id),
  findPendingReview: () => findPendingReview(),
  listReviewHistory: () => listReviewHistory(),
  lastCheckedAt: () => lastCheckedAt(),
  refreshReview: (db: unknown, opts: unknown) => refreshReview(db, opts),
  applyResolution: (db: unknown, id: string, entries: unknown, actor: string) =>
    applyResolution(db, id, entries, actor),
}));
vi.mock('@/lib/session-conflicts/cancel', () => ({
  cancelSelectedSessions: (...args: unknown[]) => cancelSelectedSessions(...args),
}));

const { GET, POST } = await import('./session-conflicts');

const pendingReview = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  status: 'pending',
  conflicts: [
    {
      specialEvent: {
        id: 1,
        title: 'Event',
        startsAt: 'a',
        endsAt: 'b',
        location: null,
        link: null,
      },
      sessions: [{ id: 10 }, { id: 11 }],
    },
  ],
  resolution: {},
  ...over,
});

const post = (
  body: unknown,
  headers: Record<string, string> = { 'content-type': 'application/json' }
) =>
  POST({
    cookies: {},
    request: new Request('https://x.test/api/admin/session-conflicts', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    // biome-ignore lint/suspicious/noExplicitAny: only the fields the route reads matter
  } as any);

describe('/api/admin/session-conflicts', () => {
  beforeEach(() => {
    requireAdmin
      .mockReset()
      .mockResolvedValue({ user: { email: 'wes@pyre.test' }, access: { isAdmin: true } });
    getDb.mockReset().mockReturnValue({});
    findReview.mockReset().mockResolvedValue(pendingReview());
    findPendingReview.mockReset().mockResolvedValue(pendingReview());
    listReviewHistory.mockReset().mockResolvedValue([]);
    lastCheckedAt.mockReset().mockResolvedValue('2026-09-14T12:00:00Z');
    refreshReview.mockReset().mockResolvedValue({ review: pendingReview(), detected: 2 });
    applyResolution.mockReset().mockResolvedValue(pendingReview({ status: 'resolved' }));
    cancelSelectedSessions.mockReset().mockResolvedValue({
      review: pendingReview({ status: 'resolved' }),
      outcomes: {},
      cancelSupport: 'supported',
      outOfTime: false,
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('passes the admin gate through untouched', async () => {
    requireAdmin.mockResolvedValue(new Response('nope', { status: 403 }));
    // biome-ignore lint/suspicious/noExplicitAny: only cookies is read
    expect((await GET({ cookies: {} } as any)).status).toBe(403);
    expect((await post({ action: 'check' })).status).toBe(403);
    expect(refreshReview).not.toHaveBeenCalled();
  });

  it('returns the open review, history, and cancel support', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: only cookies is read
    const body = await (await GET({ cookies: {} } as any)).json();
    expect(body.pending.id).toBe('r1');
    expect(body.cancelSupport).toBe('unknown');
    expect(body.horizonDays).toBe(28);
    expect(body.lastCheckedAt).toBe('2026-09-14T12:00:00Z');
  });

  it('refuses a request that is not JSON', async () => {
    expect((await post({ action: 'check' }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post('{oops', { 'content-type': 'application/json' })).status).toBe(400);
  });

  it('rejects an unknown action', async () => {
    expect((await post({ action: 'delete-everything' })).status).toBe(400);
  });

  it('says so when storage is unavailable', async () => {
    getDb.mockReturnValue(null);
    expect((await post({ action: 'check' })).status).toBe(503);
  });

  it('runs a check as the signed-in admin', async () => {
    const res = await post({ action: 'check' });
    expect(res.status).toBe(200);
    expect(refreshReview).toHaveBeenCalledWith({}, { actor: 'wes@pyre.test' });
    expect((await res.json()).detected).toBe(2);
  });

  it('reports a Momence outage as a 502 on check', async () => {
    refreshReview.mockRejectedValue(new Error('Momence Events API returned 502'));
    expect((await post({ action: 'check' })).status).toBe(502);
  });

  it('validates the session ids and refuses ids not on the review', async () => {
    expect((await post({ action: 'cancel', reviewId: 'r1' })).status).toBe(400);
    expect((await post({ action: 'cancel', reviewId: 'r1', sessionIds: [] })).status).toBe(400);
    expect((await post({ action: 'cancel', reviewId: 'r1', sessionIds: ['10'] })).status).toBe(400);
    const foreign = await post({ action: 'cancel', reviewId: 'r1', sessionIds: [10, 99] });
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error).toContain('99');
    expect(cancelSelectedSessions).not.toHaveBeenCalled();
  });

  it('refuses to cancel on a review that is no longer open', async () => {
    findReview.mockResolvedValue(pendingReview({ status: 'resolved' }));
    expect((await post({ action: 'cancel', reviewId: 'r1', sessionIds: [10] })).status).toBe(409);
    findReview.mockResolvedValue(null);
    expect((await post({ action: 'cancel', reviewId: 'r1', sessionIds: [10] })).status).toBe(404);
  });

  it('cancels as the signed-in admin, never as a name from the body', async () => {
    const res = await post({
      action: 'cancel',
      reviewId: 'r1',
      sessionIds: [10, 10, 11],
      actor: 'mallory@evil.test',
    });
    expect(res.status).toBe(200);
    const [, review, ids, actor] = cancelSelectedSessions.mock.calls[0];
    expect(review.id).toBe('r1');
    expect(ids).toEqual([10, 11]);
    expect(actor).toBe('wes@pyre.test');
  });

  it('answers 409 when the cancel lost a race with another admin', async () => {
    cancelSelectedSessions.mockResolvedValue({
      review: null,
      outcomes: {},
      cancelSupport: 'unknown',
    });
    expect((await post({ action: 'cancel', reviewId: 'r1', sessionIds: [10] })).status).toBe(409);
  });

  it('dismisses only the undecided sessions', async () => {
    findReview.mockResolvedValue(
      pendingReview({ resolution: { '10': { outcome: 'cancelled', at: 'x', by: 'y' } } })
    );
    const res = await post({ action: 'dismiss', reviewId: 'r1' });
    expect(res.status).toBe(200);
    const [, , entries, actor] = applyResolution.mock.calls[0];
    expect(Object.keys(entries)).toEqual(['11']);
    expect(entries['11']).toMatchObject({ outcome: 'skipped', message: 'Handled manually' });
    expect(actor).toBe('wes@pyre.test');
  });
});
