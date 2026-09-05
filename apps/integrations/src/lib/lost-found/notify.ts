// Asking people whether a found item is theirs, and telling staff when someone
// says yes.
//
// Two rules shape this module:
//
//   * One ask per person per item. A session blast is already a mild
//     imposition on people whose bottle it isn't; asking twice because staff
//     added another session to the same item is not acceptable. The unique
//     index on (item_id, email) is the durable half and the send_key is the
//     provider-level half — either alone would let a retry through.
//   * A failure to email one person must not stop the rest, and must not lose
//     the item. Everything here runs after the row is saved.

import type { SupabaseClient } from '@supabase/supabase-js';
import { LOST_FOUND_MANAGE } from '@/components/admin/adminTools';
import { listStaff } from '@/lib/auth/access';
import type { LostFoundItemRow, LostFoundNoticeRow } from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { buildClaimUrl } from './claim-token';
import { logLostFoundEvent } from './log';
import { categoryLabel, DONATION_PARTNER } from './types';

/** One person to ask, as the notify route hands them over. */
export interface NotifyRecipient {
  email: string;
  name?: string;
  memberId?: string;
  sessionId?: string;
  sessionName?: string;
  sessionStartsAt?: string;
}

export interface NotifyOutcome {
  email: string;
  status: 'sent' | 'already_asked' | 'failed' | 'skipped';
  reason?: string;
}

/** "Tuesday, September 2" in the bathhouse's wall-clock time. */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** "October 2" — the donation deadline, stated as a date you can act on. */
function formatShortDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
  });
}

function firstNameOf(name: string | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * What the guest sees the item called. The category gives the sentence a noun
 * when the title is a bare adjective, and the title carries the recognisable
 * part — but never the distinguishing detail, which stays on the record.
 */
export function itemLabelFor(item: LostFoundItemRow): string {
  const title = (item.title ?? '').trim();
  const category = categoryLabel(item.category ?? '').trim();
  if (!title) return category || 'item';
  if (!category) return title;
  return title.toLowerCase().includes(category.toLowerCase()) ? title : `${title} (${category})`;
}

/**
 * Ask a list of people whether an item is theirs. Anyone already asked about
 * this item is reported as `already_asked` and not emailed again.
 *
 * `photoUrl` is a signed URL minted by the caller; it must outlive the inbox,
 * so the notify route signs it for days rather than the ten minutes a
 * dashboard view gets.
 */
export async function notifyAboutItem(
  db: SupabaseClient,
  item: LostFoundItemRow,
  recipients: NotifyRecipient[],
  actor: string,
  photoUrl?: string
): Promise<NotifyOutcome[]> {
  const unique = new Map<string, NotifyRecipient>();
  for (const person of recipients) {
    const email = person.email.trim().toLowerCase();
    if (!email) continue;
    if (!unique.has(email)) unique.set(email, { ...person, email });
  }
  if (unique.size === 0) return [];

  const { data: existingRows } = await db
    .from('lost_found_notices')
    .select('email')
    .eq('item_id', item.id)
    .in('email', [...unique.keys()]);
  const alreadyAsked = new Set(
    ((existingRows ?? []) as { email: string }[]).map((r) => r.email.toLowerCase())
  );

  const shared = {
    reference: item.reference,
    itemLabel: itemLabelFor(item),
    foundDateLabel: formatDay(item.found_at),
    donateDateLabel: formatShortDay(item.donate_after),
    donationPartner: DONATION_PARTNER,
    ...(photoUrl ? { photoUrl } : {}),
  };

  const outcomes: NotifyOutcome[] = [];
  const delivered: string[] = [];

  for (const person of unique.values()) {
    if (alreadyAsked.has(person.email)) {
      outcomes.push({ email: person.email, status: 'already_asked' });
      continue;
    }

    // The notice row comes first: it is what the claim link addresses, and a
    // row with no email sent is recoverable in a way that an email with no
    // row is not.
    const { data: noticeData, error: noticeError } = await db
      .from('lost_found_notices')
      .insert({
        item_id: item.id,
        email: person.email,
        name: person.name ?? null,
        member_id: person.memberId ?? null,
        session_id: person.sessionId ?? null,
        session_name: person.sessionName ?? null,
        session_starts_at: person.sessionStartsAt ?? null,
      })
      .select('*')
      .single();

    if (noticeError || !noticeData) {
      // A unique violation means another request got there first — which is
      // exactly the outcome we want, just via a different path.
      const raced = noticeError?.code === '23505';
      outcomes.push({
        email: person.email,
        status: raced ? 'already_asked' : 'failed',
        reason: raced ? undefined : noticeError?.message,
      });
      continue;
    }

    const notice = noticeData as LostFoundNoticeRow;
    // Absent when no signing secret is configured; the template then asks them
    // to reply instead of offering a button that couldn't work.
    const claimUrl = buildClaimUrl(notice.id);

    try {
      const result = await sendTemplate({
        to: person.email,
        template: 'lost-found-found',
        props: {
          ...shared,
          firstName: firstNameOf(person.name),
          ...(claimUrl ? { claimUrl } : {}),
        },
        kind: 'transactional',
        // One ask per person per item, however the route retries.
        sendKey: `lost-found-found:${item.id}:${person.email}`,
      });

      if (result.status === 'sent') {
        outcomes.push({ email: person.email, status: 'sent' });
        delivered.push(person.email);
      } else {
        outcomes.push({ email: person.email, status: 'skipped', reason: result.reason });
      }
    } catch (e) {
      console.error(
        `[lost-found] ask to ${person.email} failed:`,
        e instanceof Error ? e.message : e
      );
      outcomes.push({
        email: person.email,
        status: 'failed',
        reason: e instanceof Error ? e.message : 'send failed',
      });
    }
  }

  if (delivered.length > 0) {
    await logLostFoundEvent(db, {
      itemId: item.id,
      action: 'notified',
      actor,
      detail: {
        recipients: delivered,
        attempted: unique.size,
        sessions: [...new Set([...unique.values()].map((p) => p.sessionName).filter(Boolean))],
      },
    });
  }

  return outcomes;
}

/** Admins plus anyone trusted with the lost-and-found queue. */
async function listLostFoundManagers(): Promise<string[]> {
  const rows = await listStaff();
  if (!rows) return [];
  return rows
    .filter((r) => r.email && (r.is_admin || r.pages.includes(LOST_FOUND_MANAGE)))
    .map((r) => r.email as string);
}

/**
 * Tell staff a guest claimed something, so it is set aside before they arrive.
 * Best-effort: the claim is already recorded by the time this runs, and a
 * guest must never see an error because our own alert failed.
 */
export async function notifyStaffOfClaim(
  item: LostFoundItemRow,
  notice: LostFoundNoticeRow,
  origin: string
): Promise<number> {
  const recipients = await listLostFoundManagers();
  if (recipients.length === 0) {
    console.warn(`[lost-found] ${item.reference} claimed but nobody is set up to be notified`);
    return 0;
  }

  const sessionLabel = notice.session_name
    ? notice.session_starts_at
      ? `${notice.session_name} — ${formatDay(notice.session_starts_at)}`
      : notice.session_name
    : '';

  const props = {
    reference: item.reference,
    itemLabel: itemLabelFor(item),
    claimantLabel: notice.name?.trim() || notice.email,
    claimantEmail: notice.email,
    sessionLabel,
    itemUrl: `${origin}/admin/lost-found/${item.id}`,
  };

  let sent = 0;
  for (const to of recipients) {
    try {
      const result = await sendTemplate({
        to,
        template: 'lost-found-claimed',
        props,
        kind: 'transactional',
        sendKey: `lost-found-claimed:${notice.id}:${to}`,
      });
      if (result.status === 'sent') sent += 1;
    } catch (e) {
      console.error(
        `[lost-found] claim alert to ${to} failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  return sent;
}
