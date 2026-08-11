// The friend-side redemption path: code -> eligibility checks -> Momence
// member find-or-create + tier tag -> `redeemed` row -> confirmation email.
// Synchronous (no approval step, unlike partner verification) because the
// referrer already vouched by sharing their code.
//
// Hard rule enforced here and re-checked at conversion: first-time customers
// only. Anyone with session booking history — attended, upcoming, or
// cancelled — is rejected.

import { createWebhookLogger } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import { getDb, type ReferralRedemptionRow } from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import {
  assignMemberTag,
  createMember,
  findMemberByEmail,
  getTagIdByName,
} from '@/lib/momence/host-api';
import { memberHasBookings } from '@/lib/webhooks/momence';
import { getTier, lookupReferrerByCode } from './registry';

const log = createWebhookLogger('Referral Redemption');

const TABLE = 'referral_redemptions';

export type RedeemResult =
  | { outcome: 'redeemed' }
  | { outcome: 'already-redeemed'; status: ReferralRedemptionRow['status'] }
  | {
      outcome: 'rejected';
      reason: 'unknown-code' | 'referrer-disabled' | 'self-referral' | 'existing-customer';
    }
  | { outcome: 'unavailable'; reason: string };

function bookUrl(code: string): string {
  const site =
    import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? 'https://pyresauna.com';
  // utm_campaign carries the code so the existing campaign-performance report
  // and booking_link_clicked attribution pick referred bookings up unchanged.
  return `${site}/events?utm_source=referral&utm_medium=referral&utm_campaign=${code.toLowerCase()}`;
}

export async function redeemReferral(params: {
  code: string;
  firstName: string;
  lastName: string;
  email: string;
}): Promise<RedeemResult> {
  const db = getDb();
  if (!db) return { outcome: 'unavailable', reason: 'db-not-configured' };

  const lookup = await lookupReferrerByCode(params.code);
  if (lookup.status === 'unavailable') {
    return { outcome: 'unavailable', reason: 'storage-unavailable' };
  }
  if (lookup.status === 'unknown') return { outcome: 'rejected', reason: 'unknown-code' };
  if (lookup.status === 'disabled') return { outcome: 'rejected', reason: 'referrer-disabled' };
  const referrer = lookup.referrer;

  const friendEmail = params.email.trim().toLowerCase();

  if (referrer.email && referrer.email === friendEmail) {
    return { outcome: 'rejected', reason: 'self-referral' };
  }

  // One referral discount per friend, ever, across all referrers. Checked
  // up front for a friendly response; the partial unique index is the real
  // guard against races.
  const { data: existing } = await db
    .from(TABLE)
    .select('id, status')
    .eq('friend_email', friendEmail)
    .in('status', ['pending', 'redeemed', 'converted'])
    .limit(1);
  if (existing && existing.length > 0) {
    return { outcome: 'already-redeemed', status: existing[0].status };
  }

  // First-time-only. A Momence record alone is fine (newsletter signups and
  // partner verifications create memberless-in-spirit rows) — booking history
  // is what disqualifies. The visits counter comes free with the member; the
  // sessions endpoint is the authoritative check behind it. When the sessions
  // check can't answer, the visits counter decides alone.
  const member = await findMemberByEmail(friendEmail);
  if (member) {
    if (member.id === referrer.momence_member_id) {
      return { outcome: 'rejected', reason: 'self-referral' };
    }
    if (member.visits.total > 0 || member.visits.openAreaVisits > 0) {
      return { outcome: 'rejected', reason: 'existing-customer' };
    }
    const hasBookings = await memberHasBookings(String(member.id));
    if (hasBookings === true) {
      return { outcome: 'rejected', reason: 'existing-customer' };
    }
  }

  const tier = await getTier(referrer.discount_percent);
  if (!tier) return { outcome: 'unavailable', reason: 'tier-missing' };
  const tagId = await getTagIdByName(tier.tag_name);
  if (tagId === null) {
    log.error(`Momence tag "${tier.tag_name}" not found — create it in the dashboard first`);
    return { outcome: 'unavailable', reason: 'tag-missing' };
  }

  const { data: inserted, error } = await db
    .from(TABLE)
    .insert({
      referrer_id: referrer.id,
      code: referrer.code,
      discount_percent: referrer.discount_percent,
      tag_name: tier.tag_name,
      friend_first_name: params.firstName.trim(),
      friend_last_name: params.lastName.trim(),
      friend_email: friendEmail,
    })
    .select('id')
    .single();
  if (error || !inserted) {
    if (error?.code === '23505') return { outcome: 'already-redeemed', status: 'pending' };
    log.error('Redemption insert failed', error);
    return { outcome: 'unavailable', reason: 'db-insert-failed' };
  }

  // Momence work happens BEFORE the status flip (house rule): a failure leaves
  // no live discount, so drop the pending row and let the friend retry.
  let memberId: number;
  let memberCreated = false;
  try {
    if (member) {
      memberId = member.id;
    } else {
      memberId = await createMember({
        email: friendEmail,
        firstName: params.firstName.trim(),
        lastName: params.lastName.trim(),
      });
      memberCreated = true;
    }
    await assignMemberTag(memberId, tagId);
  } catch (momenceError) {
    await db.from(TABLE).delete().eq('id', inserted.id);
    log.error(`Momence write failed for ${friendEmail}`, momenceError);
    return { outcome: 'unavailable', reason: 'momence-write-failed' };
  }

  const { data: updated } = await db
    .from(TABLE)
    .update({ status: 'redeemed', friend_momence_member_id: memberId })
    .eq('id', inserted.id)
    .eq('status', 'pending')
    .select('id');
  if (!updated || updated.length === 0) {
    // Should be unreachable (nothing else touches pending rows this young),
    // but the tag assignment above is idempotent either way.
    return { outcome: 'already-redeemed', status: 'redeemed' };
  }

  try {
    await sendTemplate({
      to: friendEmail,
      template: 'referral-redeemed',
      props: {
        firstName: params.firstName.trim(),
        referrerName: referrer.display_name,
        discountPercent: referrer.discount_percent,
        bookUrl: bookUrl(referrer.code),
      },
    });
  } catch (emailError) {
    // The discount is live; a lost email must not undo it.
    log.warn(`Redemption email failed for ${friendEmail}`, emailError);
  }

  await captureEvent({
    distinctId: friendEmail,
    event: 'referral_redeemed',
    properties: {
      code: referrer.code,
      referrer_type: referrer.referrer_type,
      discount_percent: referrer.discount_percent,
      member_created: memberCreated,
    },
  });

  return { outcome: 'redeemed' };
}
