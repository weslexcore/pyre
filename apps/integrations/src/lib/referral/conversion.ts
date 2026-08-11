// Conversion + reward side of the referral program, driven by the
// session-booked webhook (and re-driven by the maintenance sweep for missed
// webhooks). Best-effort by contract: every entry point catches its own
// errors — a referral hiccup must never 500 the webhook and trigger Momence
// retries.

import { createWebhookLogger } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import { getDb, type ReferralRedemptionRow, type ReferrerRow } from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { assignMemberTag, getTagIdByName, removeMemberTag } from '@/lib/momence/host-api';
import { isMemberFirstBooking } from '@/lib/webhooks/momence';
import { getReferrer, getReferrerByMemberId, getRewardTagName } from './registry';

const log = createWebhookLogger('Referral Conversion');

const TABLE = 'referral_redemptions';

/**
 * The conversion-granting booking must not also consume the reward it just
 * granted when webhooks arrive out of order — a reward is only consumable
 * this long after it was granted.
 */
const REWARD_GRACE_MS = 5 * 60 * 1000;

function rewardBookUrl(): string {
  const site =
    import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? 'https://pyresauna.com';
  return `${site}/events?utm_source=referral-reward&utm_medium=referral&utm_campaign=referral-reward`;
}

/** Remove the redemption's tier tag from the tagged member. True on success. */
async function removeDiscountTag(redemption: ReferralRedemptionRow): Promise<boolean> {
  if (!redemption.friend_momence_member_id) return false;
  try {
    const tagId = await getTagIdByName(redemption.tag_name);
    if (tagId === null) {
      log.warn(`Tier tag "${redemption.tag_name}" not found while removing — skipping`);
      return false;
    }
    await removeMemberTag(redemption.friend_momence_member_id, tagId);
    return true;
  } catch (error) {
    log.warn(`Tier tag removal failed for member ${redemption.friend_momence_member_id}`, error);
    return false;
  }
}

/**
 * Grant the referrer their reward: ledger row (the idempotency claim), reward
 * tag, email. Member referrers only — partner conversions are settled
 * manually off the redemption counts.
 */
async function grantReward(
  redemption: ReferralRedemptionRow,
  referrer: ReferrerRow,
  friendFirstName: string
): Promise<void> {
  const db = getDb();
  if (!db) return;
  if (referrer.referrer_type !== 'member' || !referrer.momence_member_id || !referrer.email) {
    return;
  }

  const rewardTagName = getRewardTagName();

  // The unique redemption_id claim makes webhook retries no-ops. Claim before
  // the Momence write: a duplicate insert means another invocation owns this
  // reward, tag and email included.
  const { error } = await db.from('referral_rewards').insert({
    referrer_id: referrer.id,
    redemption_id: redemption.id,
    reward_tag_name: rewardTagName,
  });
  if (error) {
    if (error.code !== '23505') log.error('Reward insert failed', error);
    return;
  }

  try {
    const tagId = await getTagIdByName(rewardTagName);
    if (tagId === null) {
      log.error(`Reward tag "${rewardTagName}" not found — create it in the dashboard first`);
    } else {
      await assignMemberTag(referrer.momence_member_id, tagId);
    }
  } catch (tagError) {
    // The ledger row exists either way; the admin queue surfaces grant rows
    // whose tag never landed via the Momence member view.
    log.error(`Reward tag assignment failed for referrer ${referrer.id}`, tagError);
  }

  try {
    await sendTemplate({
      to: referrer.email,
      template: 'referral-reward-earned',
      props: {
        firstName: referrer.display_name,
        friendFirstName,
        bookUrl: rewardBookUrl(),
      },
      sendKey: `referral-reward:${redemption.id}`,
    });
  } catch (emailError) {
    log.warn(`Reward email failed for ${referrer.email}`, emailError);
  }

  await captureEvent({
    distinctId: referrer.email,
    event: 'referral_reward_granted',
    properties: { code: redemption.code, redemption_id: redemption.id },
  });
}

export interface ConversionBooking {
  sessionId: number | null;
  sessionBookingId: number | null;
}

/**
 * Convert a `redeemed` row: remove the friend's discount tag, grant the
 * referrer's reward, flip the status. The caller has already decided this
 * booking qualifies (first-booking gate in the webhook path; "was booking-free
 * at redemption and has a booking now" in the reconciliation path).
 */
export async function convertRedemption(
  redemption: ReferralRedemptionRow,
  booking: ConversionBooking
): Promise<void> {
  const db = getDb();
  if (!db) return;

  // Momence work before the status flip (house rule). A failed removal still
  // converts — the maintenance sweep retries rows whose tag never came off.
  const tagRemoved = await removeDiscountTag(redemption);

  const { data: updated } = await db
    .from(TABLE)
    .update({
      status: 'converted',
      converted_session_id: booking.sessionId,
      converted_session_booking_id: booking.sessionBookingId,
      converted_at: new Date().toISOString(),
      ...(tagRemoved && { discount_tag_removed_at: new Date().toISOString() }),
    })
    .eq('id', redemption.id)
    .eq('status', 'redeemed')
    .select('id');
  // Lost a race with another webhook delivery — the winner owns the reward.
  if (!updated || updated.length === 0) return;

  const referrer = await getReferrer(redemption.referrer_id);
  if (referrer) {
    await grantReward(redemption, referrer, redemption.friend_first_name);
  }

  await captureEvent({
    distinctId: redemption.friend_email,
    event: 'referral_converted',
    properties: {
      code: redemption.code,
      discount_percent: redemption.discount_percent,
      session_id: booking.sessionId,
    },
  });
}

/**
 * The first-booking re-check failed at conversion time: the "friend" had
 * prior bookings after all (booked under this account before redeeming, or
 * accounts merged). Pull the tag, void the redemption, grant nothing.
 */
async function revokeNotFirstTime(redemption: ReferralRedemptionRow): Promise<void> {
  const db = getDb();
  if (!db) return;

  const tagRemoved = await removeDiscountTag(redemption);

  const { data: updated } = await db
    .from(TABLE)
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoke_reason: 'not-first-time',
      ...(tagRemoved && { discount_tag_removed_at: new Date().toISOString() }),
    })
    .eq('id', redemption.id)
    .eq('status', 'redeemed')
    .select('id');
  if (!updated || updated.length === 0) return;

  log.warn(
    `Redemption ${redemption.id} revoked: ${redemption.friend_email} had prior bookings at conversion time`
  );
  await captureEvent({
    distinctId: redemption.friend_email,
    event: 'referral_rejected_not_first_time',
    properties: { code: redemption.code },
  });
}

/**
 * The referrer's next booking after a reward grant consumes the reward:
 * remove the reward tag, mark the ledger row. Known v1 approximation — the
 * booking may not have actually used the discount (credit/membership
 * bookings); sales-price inspection is the v2 upgrade.
 */
async function consumeRewardIfDue(memberId: number, sessionBookingId: number): Promise<void> {
  const db = getDb();
  if (!db) return;

  const referrer = await getReferrerByMemberId(memberId);
  if (!referrer) return;

  const cutoff = new Date(Date.now() - REWARD_GRACE_MS).toISOString();
  const { data } = await db
    .from('referral_rewards')
    .select('*')
    .eq('referrer_id', referrer.id)
    .eq('status', 'granted')
    .lt('granted_at', cutoff)
    .order('granted_at', { ascending: true })
    .limit(1);
  const reward = data?.[0];
  if (!reward) return;

  let tagRemoved = false;
  try {
    const tagId = await getTagIdByName(reward.reward_tag_name);
    if (tagId !== null && referrer.momence_member_id) {
      await removeMemberTag(referrer.momence_member_id, tagId);
      tagRemoved = true;
    }
  } catch (error) {
    log.warn(`Reward tag removal failed for referrer ${referrer.id}`, error);
  }

  const { data: updated } = await db
    .from('referral_rewards')
    .update({
      status: 'consumed',
      consumed_at: new Date().toISOString(),
      consumed_session_booking_id: sessionBookingId,
      ...(tagRemoved && { reward_tag_removed_at: new Date().toISOString() }),
    })
    .eq('id', reward.id)
    .eq('status', 'granted')
    .select('id');
  if (!updated || updated.length === 0) return;

  await captureEvent({
    distinctId: referrer.email ?? referrer.code,
    event: 'referral_reward_consumed',
    properties: { code: referrer.code, session_booking_id: sessionBookingId },
  });
}

/**
 * session-booked hook. Two independent questions about the person who just
 * booked: are they a referred friend awaiting their first booking (convert +
 * reward the referrer), and are they a referrer holding an unconsumed reward
 * (consume it)?
 */
export async function handleReferralBooking(params: {
  sessionId: number;
  sessionBookingId: number;
  targetMemberId: number;
  memberEmail: string;
}): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    let { data } = await db
      .from(TABLE)
      .select('*')
      .eq('friend_momence_member_id', params.targetMemberId)
      .eq('status', 'redeemed')
      .limit(1);
    let redemption = (data?.[0] ?? null) as ReferralRedemptionRow | null;

    // Fallback: the friend booked under a different Momence record than the
    // one we tagged (email lookup at booking created a second account). The
    // discount didn't apply, but the referral is real — convert it anyway so
    // the referrer isn't cheated, and log it as its own case.
    if (!redemption && params.memberEmail) {
      ({ data } = await db
        .from(TABLE)
        .select('*')
        .eq('friend_email', params.memberEmail.trim().toLowerCase())
        .eq('status', 'redeemed')
        .limit(1));
      redemption = (data?.[0] ?? null) as ReferralRedemptionRow | null;
      if (redemption) {
        log.warn(
          `Redemption ${redemption.id} matched by email, not member id — friend booked under member ${params.targetMemberId}, tagged member is ${redemption.friend_momence_member_id}`
        );
      }
    }

    if (redemption) {
      // Hard first-time gate, re-checked at conversion. false = prior bookings
      // surfaced since redemption -> revoke, no reward. null = can't tell ->
      // leave the row for the reconciliation sweep to retry.
      const firstBooking = await isMemberFirstBooking(
        String(params.targetMemberId),
        params.sessionBookingId
      );
      if (firstBooking === false) {
        await revokeNotFirstTime(redemption);
      } else if (firstBooking === true) {
        await convertRedemption(redemption, {
          sessionId: params.sessionId,
          sessionBookingId: params.sessionBookingId,
        });
      } else {
        log.warn(`First-booking check inconclusive for redemption ${redemption.id} — deferring`);
      }
    }
  } catch (error) {
    log.error('Referral conversion handling failed', error);
  }

  try {
    await consumeRewardIfDue(params.targetMemberId, params.sessionBookingId);
  } catch (error) {
    log.error('Reward consumption handling failed', error);
  }
}

/**
 * session-booking-cancelled hook: flag a converted redemption whose
 * converting booking was cancelled. Admin decides whether to revoke the
 * reward — no automatic clawback (the reward email already went out).
 */
export async function handleReferralCancellation(sessionBookingId: number): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const { data } = await db
      .from(TABLE)
      .update({ cancelled_at: new Date().toISOString() })
      .eq('converted_session_booking_id', sessionBookingId)
      .eq('status', 'converted')
      .is('cancelled_at', null)
      .select('id, friend_email, code');
    const row = data?.[0];
    if (row) {
      log.warn(`Converting booking ${sessionBookingId} cancelled — redemption ${row.id} flagged`);
      await captureEvent({
        distinctId: row.friend_email,
        event: 'referral_conversion_cancelled',
        properties: { code: row.code, session_booking_id: sessionBookingId },
      });
    }
  } catch (error) {
    log.error('Referral cancellation handling failed', error);
  }
}
