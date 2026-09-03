// Guest signups per shift for a date range — the "N signups" chip on the
// schedule board. Fetched lazily by the island, separate from the board
// payload, so a slow or failing Momence call never delays the board paint.

import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import {
  countSignups,
  fetchScheduleFeed,
  type ShiftSignups,
  type SignupShift,
} from '@/lib/schedule/signups';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ShiftSignupsPayload {
  signups: ShiftSignups;
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!start || !DATE_RE.test(start) || !end || !DATE_RE.test(end) || end < start) {
    return json({ error: 'start and end must be YYYY-MM-DD with end >= start' }, 400);
  }

  // Drafts included: the review view shows them on the same cards.
  const { data, error } = await db
    .from('shifts')
    .select('id, shift_date, starts_at, ends_at, status')
    .gte('shift_date', start)
    .lte('shift_date', end);
  if (error) return json({ error: error.message }, 500);

  const shifts = (data ?? []) as SignupShift[];
  if (shifts.length === 0) return json({ signups: {} } satisfies ShiftSignupsPayload);

  let feed: Awaited<ReturnType<typeof fetchScheduleFeed>>;
  try {
    feed = await fetchScheduleFeed(start, end);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Momence unavailable' }, 502);
  }

  const payload: ShiftSignupsPayload = {
    signups: countSignups(shifts, feed.sessions, feed.appointments),
  };
  return json(payload);
};
