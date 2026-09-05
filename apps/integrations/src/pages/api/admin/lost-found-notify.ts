// Sending the "is this yours?" email.
//
// Two modes, matching the two halves of the feature:
//   { mode: 'owner' }                      — ask the person on the record
//   { mode: 'sessions', sessionIds: [...] } — ask everyone who was in those
//
// The session ids come from /api/admin/lost-found-sessions, but the addresses
// do not: this route re-resolves attendees from Momence itself, so a crafted
// request can't turn the blast into a mailing list. It also re-checks the
// window, so a session outside the item's own left-in window can't be
// smuggled in.
//
// Manage-gated. Emailing dozens of guests is the one act in this tool that
// reaches strangers, and it can't be taken back.

import type { APIRoute } from 'astro';
import { hasLostFoundManage } from '@/components/admin/adminTools';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import type { LostFoundAttachmentRow, LostFoundItemRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { attendeesForSession, sessionsInWindow } from '@/lib/lost-found/attendees';
import { type NotifyRecipient, notifyAboutItem } from '@/lib/lost-found/notify';
import { LOST_FOUND_BUCKET } from '@/lib/lost-found/media';
import { CLOSED_STATUSES } from '@/lib/lost-found/types';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PAGE = '/admin/lost-found';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The photo link has to survive in an inbox, not a dashboard tab, so it is
 * signed for the whole donation window plus a margin. It is an unguessable URL
 * to a picture of a water bottle — the trade against making the email useless
 * after ten minutes is not close.
 */
const PHOTO_URL_TTL_SECONDS = 40 * 24 * 60 * 60;

const emailOf = (gate: { user: { email: string } }): string =>
  (gate.user.email ?? '').trim().toLowerCase();

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;
  if (!hasLostFoundManage(gate.access)) {
    return json({ error: 'Emailing guests needs the lost-found:manage permission' }, 403);
  }

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const itemId = typeof body.itemId === 'string' ? body.itemId : '';
  if (!UUID_RE.test(itemId)) return json({ error: 'itemId must be a UUID' }, 400);

  const { data, error } = await db
    .from('lost_found_items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  const item = (data as LostFoundItemRow) ?? null;
  if (!item) return json({ error: 'Item not found' }, 404);
  if ((CLOSED_STATUSES as readonly string[]).includes(item.status)) {
    return json({ error: 'That item has already left our hands' }, 409);
  }

  let recipients: NotifyRecipient[] = [];

  if (body.mode === 'owner') {
    if (!item.owner_email) {
      return json({ error: 'No owner is recorded on this item' }, 400);
    }
    recipients = [
      {
        email: item.owner_email,
        name: item.owner_name ?? undefined,
        memberId: item.owner_member_id ?? undefined,
      },
    ];
  } else if (body.mode === 'sessions') {
    const requested = Array.isArray(body.sessionIds)
      ? body.sessionIds.filter((v): v is string => typeof v === 'string')
      : [];
    if (requested.length === 0) return json({ error: 'Pick at least one session' }, 400);

    // Re-derive the eligible sessions from the item's own window rather than
    // trusting the ids: the client picks *from* this set, it doesn't define it.
    let eligible: Awaited<ReturnType<typeof sessionsInWindow>>;
    try {
      eligible = await sessionsInWindow(item.left_window_start, item.left_window_end);
    } catch (e) {
      console.error('[lost-found] session lookup failed:', e instanceof Error ? e.message : e);
      return json({ error: "Momence is unreachable — can't resolve who was in session." }, 502);
    }

    const wanted = new Set(requested);
    const chosen = eligible.filter((s) => wanted.has(s.id));
    if (chosen.length === 0) {
      return json({ error: "Those sessions aren't in this item's window" }, 400);
    }

    const emailCache = new Map<string, string>();
    for (const session of chosen) {
      try {
        const resolved = await attendeesForSession(session, emailCache);
        for (const attendee of resolved.attendees) {
          recipients.push({
            email: attendee.email,
            name: attendee.name,
            memberId: attendee.memberId,
            sessionId: session.id,
            sessionName: session.name,
            sessionStartsAt: session.startsAt,
          });
        }
      } catch (e) {
        console.error(
          `[lost-found] attendees for session ${session.id} failed:`,
          e instanceof Error ? e.message : e
        );
      }
    }

    if (recipients.length === 0) {
      return json({ error: 'No reachable attendees in those sessions — nobody was emailed.' }, 409);
    }
  } else {
    return json({ error: "mode must be 'owner' or 'sessions'" }, 400);
  }

  // The first photo rides along in the email — it does more identifying work
  // than any wording could.
  let photoUrl: string | undefined;
  const { data: photoRow } = await db
    .from('lost_found_attachments')
    .select('*')
    .eq('item_id', itemId)
    .eq('kind', 'photo')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (photoRow) {
    const { data: signed } = await db.storage
      .from(LOST_FOUND_BUCKET)
      .createSignedUrl((photoRow as LostFoundAttachmentRow).storage_path, PHOTO_URL_TTL_SECONDS);
    photoUrl = signed?.signedUrl;
  }

  const outcomes = await notifyAboutItem(db, item, recipients, emailOf(gate), photoUrl);

  return json({
    outcomes,
    sent: outcomes.filter((o) => o.status === 'sent').length,
    alreadyAsked: outcomes.filter((o) => o.status === 'already_asked').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
  });
};
