// Total bookings on one Momence session, for the campaign detail page.
//
// The campaign report only ever sees bookings PostHog can attribute to a
// campaign. Read on its own that number has no denominator: eight attributed
// bookings is a triumph on a session that took ten and a rounding error on one
// that took sixty. This endpoint supplies the denominator straight from
// Momence, so an event campaign can show what it brought in against what the
// event took in total.
//
// One Momence call per session (plus paging), cached briefly in the shared
// Redis so opening the page repeatedly does not hammer the host API. `fresh=1`
// bypasses the cache, matching the Refresh button on the performance panel.

import { getRedis } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import type { EventBookings } from '@/lib/campaigns/event-bookings';
import { fetchSessionBookingTotals } from '@/lib/momence/session-totals';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const CACHE_PREFIX = 'cache:event-bookings:v1:';
const CACHE_TTL_SECONDS = 5 * 60;

/** What is stored; `cached` is added per response, so it never goes stale in
 * the cache entry itself. */
type CachedTotals = Omit<EventBookings, 'cached'>;

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;

  const raw = (url.searchParams.get('event') ?? '').trim();
  const sessionId = Number.parseInt(raw, 10);
  // Momence session ids are positive integers; anything else is a destination
  // that does not name a session (a blog post, an external URL).
  if (!Number.isInteger(sessionId) || sessionId <= 0 || String(sessionId) !== raw) {
    return json({ error: 'event must be a Momence session id' }, 400);
  }

  const redis = getRedis();
  const cacheKey = `${CACHE_PREFIX}${sessionId}`;

  try {
    if (url.searchParams.get('fresh') !== '1') {
      const cached = await redis?.get<CachedTotals>(cacheKey);
      if (cached) return json({ ...cached, cached: true });
    }

    const totals = await fetchSessionBookingTotals(sessionId);
    const payload: CachedTotals = {
      sessionId: String(sessionId),
      ...totals,
      generatedAt: new Date().toISOString(),
    };
    await redis?.set(cacheKey, payload, { ex: CACHE_TTL_SECONDS });
    return json({ ...payload, cached: false });
  } catch (err) {
    // Momence being unreachable must not break the performance panel: the
    // attributed numbers still read, and the panel says the total is missing.
    console.error(
      `[event-bookings] session ${sessionId} lookup failed:`,
      err instanceof Error ? err.message : err
    );
    return json({ error: 'Momence is unreachable, so the event total is unavailable.' }, 502);
  }
};
