// Who a signed-in person may @-mention on a page whose conversations are
// open to everyone who holds it — the shift notes log, where the composer in
// the header can be opened from any admin page and has no other read to ride
// on. The caller must hold the page themselves; the list is the page's other
// holders, by name, with their admin flag so the island can narrow it for an
// admins-only note or a private reply (lib/shift-notes/mentions).
//
// Subjects with their own audience (a message, a card, an incident) carry
// their candidates on their own reads instead.
//
//   GET ?page=<href> → { people: MentionCandidate[] }

import type { APIRoute } from 'astro';
import { SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import { listStaff } from '@/lib/auth/access';
import { requirePage } from '@/lib/auth/admin';
import { json } from '@/lib/http/route';
import { pageMentionCandidates } from '@/lib/mentions';

/** The pages whose holders may all name each other. */
const MENTION_PAGES = new Set([SHIFT_NOTES_HREF]);

export const GET: APIRoute = async ({ cookies, url }) => {
  const page = url.searchParams.get('page') ?? '';
  if (!MENTION_PAGES.has(page)) {
    return json({ error: `page must be one of ${[...MENTION_PAGES].join(', ')}` }, 400);
  }
  const gate = await requirePage(cookies, page);
  if (gate instanceof Response) return gate;

  return json({ people: pageMentionCandidates((await listStaff()) ?? [], page) });
};
