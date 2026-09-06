// The Momence side of a guest profile: account, purchases, session history.
// Read live (three or four Host API calls), so it is separate from
// /api/admin/guests and the profile page fills this panel in second.
// `?fresh=1` bypasses the pack cache for the Refresh button.
//
// One deliberate side effect for a GET: when Momence answers and we hold a
// profile whose cached name or email has drifted, the copies are brought up
// to date. They exist only so the list can be searched; keeping them current
// on every profile view beats a separate sync job.
//
// Read-only from the caller's point of view, so no CSRF preamble.

import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { loadMomenceSnapshot } from '@/lib/guests/momence';
import { loadProfileByMemberId } from '@/lib/guests/store';
import { GUESTS_PAGE } from '@/lib/guests/types';
import { normalizeMemberId } from '@/lib/guests/validate';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, GUESTS_PAGE);
  if (gate instanceof Response) return gate;

  const memberId = normalizeMemberId(url.searchParams.get('memberId'));
  if (!memberId) return json({ error: 'memberId must be a Momence member id' }, 400);

  const fresh = url.searchParams.get('fresh') === '1';
  const snapshot = await loadMomenceSnapshot(Number(memberId), { fresh });

  const db = getDb();
  if (db && snapshot.account) {
    const profile = await loadProfileByMemberId(db, memberId);
    if (
      profile &&
      (profile.name !== snapshot.account.name || profile.email !== snapshot.account.email)
    ) {
      await db
        .from('guest_profiles')
        .update({ name: snapshot.account.name, email: snapshot.account.email })
        .eq('id', profile.id);
    }
  }

  return json(snapshot);
};
