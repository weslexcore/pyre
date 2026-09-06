// Who is coming — the roster behind /admin/guests/sessions.
//   GET ?date=YYYY-MM-DD               — the day's sessions with booking counts
//   GET ?date=YYYY-MM-DD&sessionId=N   — one session's roster, each guest with
//                                        their profile highlights and the
//                                        Momence facts worth knowing
//
// Read-only, so no CSRF preamble. Gated on the guests page: this response
// carries names, emails, and what we know about people, which is exactly
// what that page is for. Momence being down leaves `available: false` and an
// empty list rather than an error: the page says so and the rest of the
// tool keeps working.

import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { rosterForSession, sessionsOnDate } from '@/lib/guests/roster';
import { loadFields } from '@/lib/guests/store';
import { GUESTS_PAGE } from '@/lib/guests/types';
import { getPeopleNames } from '@/lib/sops/people';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SESSION_ID_RE = /^\d{1,20}$/;

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, GUESTS_PAGE);
  if (gate instanceof Response) return gate;

  const date = url.searchParams.get('date') ?? '';
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return json({ error: 'date must be YYYY-MM-DD' }, 400);
  }

  let sessions: Awaited<ReturnType<typeof sessionsOnDate>>;
  try {
    sessions = await sessionsOnDate(date);
  } catch (e) {
    console.error('[guests] session list failed:', e instanceof Error ? e.message : e);
    return json({
      available: false,
      date,
      sessions: [],
      error: "Momence is unreachable — can't list today's sessions.",
    });
  }

  const sessionId = url.searchParams.get('sessionId');
  if (sessionId === null) return json({ available: true, date, sessions });

  if (!SESSION_ID_RE.test(sessionId)) return json({ error: 'sessionId must be numeric' }, 400);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return json({ error: 'That session is not on this day' }, 404);

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  try {
    const fields = await loadFields(db);
    const roster = await rosterForSession(db, session, fields);
    const people = await getPeopleNames(
      roster.guests.map((g) => g.latestNote?.author ?? '').filter(Boolean)
    );
    return json({ available: true, date, roster, people });
  } catch (e) {
    console.error('[guests] roster failed:', e instanceof Error ? e.message : e);
    return json({
      available: false,
      date,
      roster: null,
      error: "Momence is unreachable — can't see who is booked.",
    });
  }
};
