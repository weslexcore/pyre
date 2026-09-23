// Momence totals for selected sessions, with the legacy single-event response
// retained. Per-session caching is shared between campaigns. A failed slot
// makes the combined total unavailable rather than silently undercounting.

import { getRedis } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import {
  combineEventBookings,
  type EventBookings,
  parseSessionIds,
} from '@/lib/campaigns/event-bookings';
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

  const multiple = url.searchParams.has('events');
  const ids = parseSessionIds(
    multiple
      ? (url.searchParams.get('events') ?? '').split(',')
      : [(url.searchParams.get('event') ?? '').trim()]
  );
  if (!ids?.length)
    return json({ error: 'Select between 1 and 50 valid Momence session ids' }, 400);

  const redis = getRedis();
  async function readSession(sessionId: string): Promise<EventBookings> {
    const cacheKey = `${CACHE_PREFIX}${sessionId}`;
    if (url.searchParams.get('fresh') !== '1') {
      const cached = await redis?.get<CachedTotals>(cacheKey);
      if (cached) return { ...cached, cached: true };
    }
    const totals = await fetchSessionBookingTotals(Number(sessionId));
    const payload: CachedTotals = { sessionId, ...totals, generatedAt: new Date().toISOString() };
    await redis?.set(cacheKey, payload, { ex: CACHE_TTL_SECONDS });
    return { ...payload, cached: false };
  }

  try {
    const sessions: EventBookings[] = [];
    // At most four concurrent Momence reads, including pagination.
    for (let offset = 0; offset < ids.length; offset += 4) {
      sessions.push(...(await Promise.all(ids.slice(offset, offset + 4).map(readSession))));
    }
    return json(multiple ? combineEventBookings(sessions) : sessions[0]);
  } catch (err) {
    console.error('[event-bookings] lookup failed:', err instanceof Error ? err.message : err);
    return json(
      { error: 'Some slots could not be read from Momence. The combined total is unavailable.' },
      502
    );
  }
};
