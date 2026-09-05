// "Who was here when this was left?" — the session picker behind the
// unknown-owner blast.
//
// Returns the Momence sessions overlapping a window with the people in each,
// so a staff member can choose who to email rather than the system deciding.
// Addresses are masked in this response: choosing which sessions to ask does
// not require reading forty guests' email addresses, and this endpoint is
// reachable by anyone who can open the page. The notify route resolves the
// real addresses server-side from the session ids it is given.
//
// Read-only, so no CSRF preamble. Gated on the page rather than on manage:
// seeing who was in the building is part of working out whose bottle it is,
// and the send itself is what needs the extra permission.

import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import { attendeesInWindow } from '@/lib/lost-found/attendees';
import { MAX_WINDOW_HOURS } from '@/lib/lost-found/types';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PAGE = '/admin/lost-found';
const HOUR_MS = 3_600_000;

/** "a•••@example.com" — enough to recognise your own address, not to harvest. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  const head = local.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(2, Math.min(local.length - 1, 5)))}@${domain}`;
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const start = url.searchParams.get('start') ?? '';
  const end = url.searchParams.get('end') ?? '';
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return json({ error: 'start and end must be dates' }, 400);
  }
  if (endMs < startMs) return json({ error: 'The window ends before it starts' }, 400);
  if (endMs - startMs > MAX_WINDOW_HOURS * HOUR_MS) {
    return json({ error: `Keep the window under ${MAX_WINDOW_HOURS} hours` }, 400);
  }

  try {
    const { sessions, identityAvailable } = await attendeesInWindow(start, end);

    return json({
      available: true,
      identityAvailable,
      sessions: sessions.map((s) => ({
        id: s.session.id,
        name: s.session.name,
        startsAt: s.session.startsAt,
        endsAt: s.session.endsAt,
        bookingCount: s.bookingCount,
        identityAvailable: s.identityAvailable,
        attendees: s.attendees.map((a) => ({
          name: a.name,
          maskedEmail: maskEmail(a.email),
          checkedIn: a.checkedIn,
        })),
      })),
    });
  } catch (e) {
    // Momence being down must not break the page: the picker says so and the
    // known-owner path still works.
    console.error('[lost-found] session lookup failed:', e instanceof Error ? e.message : e);
    return json({
      available: false,
      identityAvailable: false,
      sessions: [],
      error: "Momence is unreachable — can't look up who was in session.",
    });
  }
};
