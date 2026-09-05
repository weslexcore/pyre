// The "this is mine" link from a lost-and-found email.
//
// GET renders a page with a button. POST is what actually records the claim.
// That split is deliberate and is the reason this route doesn't look like
// /api/unsubscribe, which acts on GET: corporate mail scanners and link
// preview bots fetch every URL in an inbound message, so a GET that claimed
// the item would mark half a session's blast as claimed before a human read
// a word. Unsubscribing a bot's own address is harmless; claiming someone
// else's ring is not.
//
// The token carries a signed notice id, so the claim is attributed to the
// person we actually emailed — no form to fill in, and nothing a guest can
// type to claim as someone else. Staff still check the description at pickup;
// this sets the item aside and tells them who is coming.
//
// Public by necessity, so it says as little as possible: an invalid token and
// a claimed item get the same neutral page, and nothing here reveals the item
// description or anyone's address.

import type { APIRoute } from 'astro';
import type { LostFoundItemRow, LostFoundNoticeRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { verifyClaimToken } from '@/lib/lost-found/claim-token';
import { logLostFoundEvent } from '@/lib/lost-found/log';
import { notifyStaffOfClaim } from '@/lib/lost-found/notify';
import { CLOSED_STATUSES, DONATION_PARTNER } from '@/lib/lost-found/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Pyre — Lost &amp; Found</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.6}h1{font-size:1.25rem}button{background:#d15232;color:#fff;border:0;border-radius:6px;font:inherit;font-weight:600;padding:12px 24px;cursor:pointer}button:disabled{opacity:.6;cursor:default}</style></head><body><h1>Pyre Sauna</h1>${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/** Same neutral page for a bad token, a deleted item, and one already gone. */
function unavailablePage(): Response {
  return page(
    `<p>This link is no longer active. If you think something of yours is still at Pyre, email <a href="mailto:hello@pyresauna.com">hello@pyresauna.com</a> and we'll check the bin.</p>`,
    410
  );
}

interface Resolved {
  notice: LostFoundNoticeRow;
  item: LostFoundItemRow;
}

async function resolve(token: string): Promise<Resolved | null> {
  const noticeId = verifyClaimToken(token);
  if (!noticeId || !UUID_RE.test(noticeId)) return null;

  const db = getDb();
  if (!db) return null;

  const { data: noticeData } = await db
    .from('lost_found_notices')
    .select('*')
    .eq('id', noticeId)
    .maybeSingle();
  const notice = (noticeData as LostFoundNoticeRow) ?? null;
  if (!notice) return null;

  const { data: itemData } = await db
    .from('lost_found_items')
    .select('*')
    .eq('id', notice.item_id)
    .maybeSingle();
  const item = (itemData as LostFoundItemRow) ?? null;
  if (!item) return null;

  return { notice, item };
}

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token') ?? '';
  const resolved = await resolve(token);
  if (!resolved) return unavailablePage();

  const { notice, item } = resolved;

  if ((CLOSED_STATUSES as readonly string[]).includes(item.status)) {
    return item.status === 'picked_up'
      ? page(`<p>This one is already back with its owner. Thanks for checking.</p>`)
      : page(
          `<p>This item has already gone to ${escapeHtml(DONATION_PARTNER)}. Sorry we missed you — email <a href="mailto:hello@pyresauna.com">hello@pyresauna.com</a> if you think that's wrong.</p>`
        );
  }

  if (notice.response === 'claimed') {
    return page(
      `<p>You've already claimed this one — it's set aside at the front desk under <strong>${escapeHtml(item.reference)}</strong>. Just ask for it on your next visit.</p>`
    );
  }

  // The button posts back here; no JavaScript beyond the form itself, so it
  // works in whatever browser the email opened in.
  return page(
    `<p>We found a <strong>${escapeHtml(item.title)}</strong> and asked whether it might be yours.</p>
     <p>Confirm below and we'll set it aside at the front desk for your next visit.</p>
     <form method="post" action="${escapeHtml(url.pathname)}?token=${encodeURIComponent(token)}">
       <button type="submit">Yes, that's mine</button>
     </form>
     <p style="font-size:14px;opacity:.75;margin-top:2rem">Not yours? You can close this page — nothing happens unless you confirm. Reference ${escapeHtml(item.reference)}.</p>`
  );
};

export const POST: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token') ?? '';
  const resolved = await resolve(token);
  if (!resolved) return unavailablePage();

  const { notice, item } = resolved;
  const db = getDb();
  if (!db) return unavailablePage();

  if ((CLOSED_STATUSES as readonly string[]).includes(item.status)) {
    return page(
      `<p>This item has already left our hands. Email <a href="mailto:hello@pyresauna.com">hello@pyresauna.com</a> if you think that's wrong.</p>`
    );
  }

  const confirmation = page(
    `<p>Got it — the <strong>${escapeHtml(item.title)}</strong> is set aside for you at the front desk under <strong>${escapeHtml(item.reference)}</strong>.</p>
     <p>Ask for it on your next visit. We'll check a couple of details with you when you collect it.</p>`
  );

  // Already claimed by this person: same confirmation, no second alert. A
  // double tap on a phone must not page staff twice.
  if (notice.response === 'claimed') return confirmation;

  const now = new Date().toISOString();
  const { error: noticeError } = await db
    .from('lost_found_notices')
    .update({ response: 'claimed', responded_at: now })
    .eq('id', notice.id)
    .is('responded_at', null);
  if (noticeError) {
    console.error('[lost-found] claim write failed:', noticeError.message);
    return page(
      `<p>Something went wrong recording that. Email <a href="mailto:hello@pyresauna.com">hello@pyresauna.com</a> and we'll set it aside by hand.</p>`,
      500
    );
  }

  // First claim wins the item; a second person clicking later still records
  // their notice response, and staff see both on the record.
  const { data: updated } = await db
    .from('lost_found_items')
    .update({
      status: 'claim_pending',
      claimed_by_email: notice.email,
      claimed_by_name: notice.name,
      claimed_at: now,
      updated_at: now,
    })
    .eq('id', item.id)
    .in('status', ['unclaimed', 'due_for_donation'])
    .select('*')
    .maybeSingle();

  await logLostFoundEvent(db, {
    itemId: item.id,
    action: 'claim_received',
    actor: 'guest',
    detail: {
      email: notice.email,
      notice_id: notice.id,
      session_name: notice.session_name,
      first_claim: Boolean(updated),
    },
  });

  // Best-effort: the claim is recorded either way, and a guest must never see
  // an error because our own alert failed.
  try {
    await notifyStaffOfClaim((updated as LostFoundItemRow) ?? item, notice, new URL(url).origin);
  } catch (e) {
    console.error('[lost-found] claim alert failed:', e instanceof Error ? e.message : e);
  }

  return confirmation;
};
