// Hourly upkeep for the referral program, run from the cron tick:
//   - reconcile: convert `redeemed` rows whose friend booked but whose
//     webhook we missed (or whose first-booking check was inconclusive)
//   - expire: redemptions unbooked past the window, rewards unused past 90d
//   - retag cleanup: converted rows whose discount tag never came off
//   - stale pending: rows that crashed between insert and the Momence write
//
// Everything is idempotent: status flips are conditional updates, tag
// removals are safe to repeat, and dryRun reports without writing.

import { createWebhookLogger } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb, type ReferralRedemptionRow, type ReferralRewardRow } from '@/lib/db';
import { getTagIdByName, removeMemberTag } from '@/lib/momence/host-api';
import { memberHasBookings } from '@/lib/webhooks/momence';
import { convertRedemption } from './conversion';
import { getRedemptionExpiryDays, REWARD_EXPIRY_DAYS } from './registry';

const log = createWebhookLogger('Referral Maintenance');

const TABLE = 'referral_redemptions';
const BATCH = 25;

/** Give the webhook a clear head start before the sweep second-guesses it. */
const RECONCILE_MIN_AGE_MS = 2 * 60 * 60 * 1000;
const STALE_PENDING_MS = 60 * 60 * 1000;

async function removeTagFromMember(memberId: number | null, tagName: string): Promise<boolean> {
  if (!memberId) return false;
  try {
    const tagId = await getTagIdByName(tagName);
    if (tagId === null) return false;
    await removeMemberTag(memberId, tagId);
    return true;
  } catch (error) {
    log.warn(`Tag removal failed for member ${memberId} / ${tagName}`, error);
    return false;
  }
}

/**
 * Missed-webhook reconciliation. Eligibility guaranteed zero bookings at
 * redemption time, so any booking now IS the first — convert without
 * re-gating.
 */
async function reconcileRedeemed(
  ctx: CronJobContext
): Promise<{ converted: number; wouldConvert: string[] }> {
  const db = getDb();
  if (!db) return { converted: 0, wouldConvert: [] };

  const cutoff = new Date(Date.now() - RECONCILE_MIN_AGE_MS).toISOString();
  const { data } = await db
    .from(TABLE)
    .select('*')
    .eq('status', 'redeemed')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(BATCH);
  const rows = (data ?? []) as ReferralRedemptionRow[];

  let converted = 0;
  const wouldConvert: string[] = [];
  for (const row of rows) {
    if (ctx.timeRemainingMs() < 10_000) break;
    if (!row.friend_momence_member_id) continue;

    const hasBookings = await memberHasBookings(String(row.friend_momence_member_id));
    if (hasBookings !== true) continue;

    if (ctx.dryRun) {
      wouldConvert.push(`${row.code}:${row.friend_email}`);
      continue;
    }
    // Session ids unknown here — the row records the conversion, not the
    // specific booking. Cancellation flagging only works for webhook-observed
    // conversions, which is fine.
    await convertRedemption(row, { sessionId: null, sessionBookingId: null });
    converted += 1;
  }

  return { converted, wouldConvert };
}

async function expireRedemptions(
  ctx: CronJobContext
): Promise<{ expired: number; wouldExpire: string[] }> {
  const db = getDb();
  if (!db) return { expired: 0, wouldExpire: [] };

  const cutoff = new Date(
    Date.now() - getRedemptionExpiryDays() * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data } = await db
    .from(TABLE)
    .select('*')
    .eq('status', 'redeemed')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(BATCH);
  const rows = (data ?? []) as ReferralRedemptionRow[];

  if (ctx.dryRun) {
    return { expired: 0, wouldExpire: rows.map((r) => `${r.code}:${r.friend_email}`) };
  }

  let expired = 0;
  for (const row of rows) {
    if (ctx.timeRemainingMs() < 10_000) break;
    const tagRemoved = await removeTagFromMember(row.friend_momence_member_id, row.tag_name);
    const { data: updated } = await db
      .from(TABLE)
      .update({
        status: 'expired',
        decided_by: 'cron',
        ...(tagRemoved && { discount_tag_removed_at: new Date().toISOString() }),
      })
      .eq('id', row.id)
      .eq('status', 'redeemed')
      .select('id');
    if (!updated || updated.length === 0) continue;
    expired += 1;
    await captureEvent({
      distinctId: row.friend_email,
      event: 'referral_expired',
      properties: { code: row.code },
    });
  }

  return { expired, wouldExpire: [] };
}

async function expireRewards(
  ctx: CronJobContext
): Promise<{ expired: number; wouldExpire: string[] }> {
  const db = getDb();
  if (!db) return { expired: 0, wouldExpire: [] };

  const cutoff = new Date(Date.now() - REWARD_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from('referral_rewards')
    .select('*')
    .eq('status', 'granted')
    .lt('granted_at', cutoff)
    .order('granted_at', { ascending: true })
    .limit(BATCH);
  const rows = (data ?? []) as ReferralRewardRow[];

  if (ctx.dryRun) {
    return { expired: 0, wouldExpire: rows.map((r) => r.id) };
  }

  let expired = 0;
  for (const row of rows) {
    if (ctx.timeRemainingMs() < 10_000) break;
    const { data: referrerRows } = await db
      .from('referrers')
      .select('momence_member_id, email, code')
      .eq('id', row.referrer_id)
      .maybeSingle<{ momence_member_id: number | null; email: string | null; code: string }>();
    const tagRemoved = await removeTagFromMember(
      referrerRows?.momence_member_id ?? null,
      row.reward_tag_name
    );
    const { data: updated } = await db
      .from('referral_rewards')
      .update({
        status: 'expired',
        decided_by: 'cron',
        ...(tagRemoved && { reward_tag_removed_at: new Date().toISOString() }),
      })
      .eq('id', row.id)
      .eq('status', 'granted')
      .select('id');
    if (!updated || updated.length === 0) continue;
    expired += 1;
    await captureEvent({
      distinctId: referrerRows?.email ?? referrerRows?.code ?? row.referrer_id,
      event: 'referral_reward_expired',
      properties: { code: referrerRows?.code },
    });
  }

  return { expired, wouldExpire: [] };
}

/** Converted/expired/revoked rows whose discount tag never actually came off. */
async function retryDanglingTagRemovals(ctx: CronJobContext): Promise<{ removed: number }> {
  const db = getDb();
  if (!db) return { removed: 0 };

  const { data } = await db
    .from(TABLE)
    .select('*')
    .in('status', ['converted', 'expired', 'revoked'])
    .is('discount_tag_removed_at', null)
    .not('friend_momence_member_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(BATCH);
  const rows = (data ?? []) as ReferralRedemptionRow[];

  let removed = 0;
  for (const row of rows) {
    if (ctx.timeRemainingMs() < 10_000) break;
    if (ctx.dryRun) continue;
    const tagRemoved = await removeTagFromMember(row.friend_momence_member_id, row.tag_name);
    if (!tagRemoved) continue;
    await db
      .from(TABLE)
      .update({ discount_tag_removed_at: new Date().toISOString() })
      .eq('id', row.id);
    removed += 1;
  }

  return { removed };
}

/**
 * Rows that crashed between insert and the redeemed flip. The Momence tag may
 * or may not have landed, so attempt removal, then expire (not delete — the
 * audit trail keeps no-deletes) and free the friend_email for a clean retry.
 */
async function expireStalePending(ctx: CronJobContext): Promise<{ cleaned: number }> {
  const db = getDb();
  if (!db) return { cleaned: 0 };

  const cutoff = new Date(Date.now() - STALE_PENDING_MS).toISOString();
  const { data } = await db
    .from(TABLE)
    .select('*')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(BATCH);
  const rows = (data ?? []) as ReferralRedemptionRow[];

  let cleaned = 0;
  for (const row of rows) {
    if (ctx.timeRemainingMs() < 10_000) break;
    if (ctx.dryRun) continue;
    const tagRemoved = await removeTagFromMember(row.friend_momence_member_id, row.tag_name);
    const { data: updated } = await db
      .from(TABLE)
      .update({
        status: 'expired',
        decided_by: 'cron',
        revoke_reason: 'stale-pending',
        ...(tagRemoved && { discount_tag_removed_at: new Date().toISOString() }),
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id');
    if (updated && updated.length > 0) cleaned += 1;
  }

  return { cleaned };
}

export async function runReferralMaintenance(
  ctx: CronJobContext
): Promise<Record<string, unknown>> {
  const reconcile = await reconcileRedeemed(ctx);
  const redemptionExpiry = await expireRedemptions(ctx);
  const rewardExpiry = await expireRewards(ctx);
  const dangling = await retryDanglingTagRemovals(ctx);
  const stalePending = await expireStalePending(ctx);

  return {
    reconciledConversions: reconcile.converted,
    redemptionsExpired: redemptionExpiry.expired,
    rewardsExpired: rewardExpiry.expired,
    danglingTagsRemoved: dangling.removed,
    stalePendingCleaned: stalePending.cleaned,
    ...(ctx.dryRun && {
      wouldConvert: reconcile.wouldConvert,
      wouldExpireRedemptions: redemptionExpiry.wouldExpire,
      wouldExpireRewards: rewardExpiry.wouldExpire,
    }),
  };
}
