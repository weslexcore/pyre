// People lookup for the incident report form: who was this, and how do we
// reach them tomorrow?
//
// Two sources, because a bathhouse incident involves two kinds of person:
//   ?source=staff            our roster, straight from the staff table
//   ?source=guest&q=<name>   Momence's customer search
//
// Getting a guest's real name and phone number off their Momence record beats
// a staff member typing what they think they heard while someone is sitting
// on a bench with an ice pack — it makes follow-up possible and it links the
// report to the account. Anyone the search can't find is still enterable by
// hand on the form ('other'), so a lookup outage never blocks a report.
//
// Gated on the pages that use it — the incident form and the lost-and-found
// log, which asks the same question ("who is this guest, and how do we reach
// them?") of the same source. Read-only, so no CSRF preamble: there is
// nothing here to forge.

import type { APIRoute } from 'astro';
import { listStaff } from '@/lib/auth/access';
import { requireAnyPage } from '@/lib/auth/admin';
import { fetchMembersFiltered } from '@/lib/momence/host-api';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PAGES = ['/admin/incidents', '/admin/lost-found'];

/** Below this a search matches half the customer list; the form waits. */
const MIN_QUERY_LENGTH = 2;
const GUEST_RESULT_LIMIT = 8;

/** One person the form can drop straight into a report. */
interface PersonResult {
  /** Momence member id as a string, or '' for staff and manual entries. */
  memberId: string;
  name: string;
  email: string;
  phone: string;
  /** Shown under the name to tell two similar people apart. */
  detail?: string;
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAnyPage(cookies, PAGES);
  if (gate instanceof Response) return gate;

  const source = url.searchParams.get('source');

  if (source === 'staff') {
    const rows = await listStaff();
    if (!rows) return json({ people: [], source: 'staff', available: false });

    // Everyone currently on the roster, by name. Inactive people are left out
    // — a report being filed today is about who is here today — but anyone
    // missing can still be added as 'other'.
    const people: PersonResult[] = rows
      .filter((r) => r.active && r.display_name)
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .map((r) => ({
        memberId: '',
        name: r.display_name,
        email: r.email ?? '',
        phone: '',
      }));

    return json({ people, source: 'staff', available: true });
  }

  if (source === 'guest') {
    const query = (url.searchParams.get('q') ?? '').trim();
    if (query.length < MIN_QUERY_LENGTH) {
      return json({ people: [], source: 'guest', available: true });
    }

    try {
      const { members } = await fetchMembersFiltered({
        page: 0,
        pageSize: GUEST_RESULT_LIMIT,
        query,
        sortBy: 'lastSeenAt',
        sortOrder: 'DESC',
      });

      const people: PersonResult[] = members.map((m) => ({
        memberId: String(m.id),
        name: [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email,
        email: m.email ?? '',
        phone: m.phoneNumber ?? '',
        detail: m.email ?? undefined,
      }));

      return json({ people, source: 'guest', available: true });
    } catch (e) {
      // Momence being down must not stop a report: the form falls back to
      // manual entry when `available` comes back false.
      console.error('[incidents] guest search failed:', e instanceof Error ? e.message : e);
      return json({
        people: [],
        source: 'guest',
        available: false,
        error: 'Guest search is unavailable — enter their details by hand.',
      });
    }
  }

  return json({ error: 'source must be staff or guest' }, 400);
};
