// Manual admin actions on the referral program: revoking a live discount or an
// unconsumed reward. Both pull the Momence tag first (the actual discount)
// and then flip the row with a conditional update, same ordering as the
// automated paths.

import { createWebhookLogger } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import { getDb, type ReferralRedemptionRow, type ReferralRewardRow } from '@/lib/db';
import { getTagIdByName, removeMemberTag } from '@/lib/momence/host-api';

const log = createWebhookLogger('Referral Admin');

export type RevokeResult =
  | { outcome: 'revoked' }
  | { outcome: 'not-found' }
  | { outcome: 'not-revocable'; status: string };

export async function revokeRedemption(
  id: string,
  actorEmail: string,
  reason?: string
): Promise<RevokeResult> {
  const db = getDb();
  if (!db) throw new Error('Supabase not configured');

  const { data: row } = await db
    .from('referral_redemptions')
    .select('*')
    .eq('id', id)
    .maybeSingle<ReferralRedemptionRow>();
  if (!row) return { outcome: 'not-found' };
  // Only live discounts can be revoked; converted history stays converted.
  if (row.status !== 'redeemed' && row.status !== 'pending') {
    return { outcome: 'not-revocable', status: row.status };
  }

  let tagRemoved = false;
  if (row.friend_momence_member_id) {
    try {
      const tagId = await getTagIdByName(row.tag_name);
      if (tagId !== null) {
        await removeMemberTag(row.friend_momence_member_id, tagId);
        tagRemoved = true;
      }
    } catch (error) {
      // Leave discount_tag_removed_at null — the maintenance sweep retries.
      log.warn(`Revoke tag removal failed for redemption ${id}`, error);
    }
  }

  const { data: updated } = await db
    .from('referral_redemptions')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoke_reason: reason?.trim() || 'admin',
      decided_by: actorEmail,
      ...(tagRemoved && { discount_tag_removed_at: new Date().toISOString() }),
    })
    .eq('id', id)
    .in('status', ['redeemed', 'pending'])
    .select('id');
  if (!updated || updated.length === 0) return { outcome: 'not-revocable', status: row.status };

  await captureEvent({
    distinctId: row.friend_email,
    event: 'referral_revoked',
    properties: { code: row.code, reason: reason?.trim() || 'admin' },
  });
  return { outcome: 'revoked' };
}

export async function revokeReward(id: string, actorEmail: string): Promise<RevokeResult> {
  const db = getDb();
  if (!db) throw new Error('Supabase not configured');

  const { data: row } = await db
    .from('referral_rewards')
    .select('*')
    .eq('id', id)
    .maybeSingle<ReferralRewardRow>();
  if (!row) return { outcome: 'not-found' };
  if (row.status !== 'granted') return { outcome: 'not-revocable', status: row.status };
  // Credit rewards are already delivered — pulling the credit back is a
  // dashboard decision, not a one-click revoke.
  if (row.reward_type === 'credit') return { outcome: 'not-revocable', status: 'delivered' };

  const { data: referrer } = await db
    .from('referrers')
    .select('momence_member_id, email, code')
    .eq('id', row.referrer_id)
    .maybeSingle<{ momence_member_id: number | null; email: string | null; code: string }>();

  // Only discount rewards have a tag to pull; manual comps are just status.
  let tagRemoved = false;
  if (row.reward_type === 'discount' && referrer?.momence_member_id) {
    try {
      const tagId = await getTagIdByName(row.reward_tag_name);
      if (tagId !== null) {
        await removeMemberTag(referrer.momence_member_id, tagId);
        tagRemoved = true;
      }
    } catch (error) {
      log.warn(`Revoke tag removal failed for reward ${id}`, error);
    }
  }

  const { data: updated } = await db
    .from('referral_rewards')
    .update({
      status: 'revoked',
      decided_by: actorEmail,
      ...(tagRemoved && { reward_tag_removed_at: new Date().toISOString() }),
    })
    .eq('id', id)
    .eq('status', 'granted')
    .select('id');
  if (!updated || updated.length === 0) return { outcome: 'not-revocable', status: row.status };

  await captureEvent({
    distinctId: referrer?.email ?? referrer?.code ?? row.referrer_id,
    event: 'referral_reward_revoked',
    properties: { code: referrer?.code },
  });
  return { outcome: 'revoked' };
}

/**
 * Staff delivered a manual comp (e.g. an unlimited member's free session) —
 * close the ledger row out.
 */
export async function fulfillReward(id: string, actorEmail: string): Promise<RevokeResult> {
  const db = getDb();
  if (!db) throw new Error('Supabase not configured');

  const { data: row } = await db
    .from('referral_rewards')
    .select('*')
    .eq('id', id)
    .maybeSingle<ReferralRewardRow>();
  if (!row) return { outcome: 'not-found' };
  if (row.status !== 'granted' || row.reward_type !== 'manual') {
    return { outcome: 'not-revocable', status: row.status };
  }

  const { data: updated } = await db
    .from('referral_rewards')
    .update({
      status: 'consumed',
      consumed_at: new Date().toISOString(),
      decided_by: actorEmail,
    })
    .eq('id', id)
    .eq('status', 'granted')
    .select('id');
  if (!updated || updated.length === 0) return { outcome: 'not-revocable', status: row.status };
  return { outcome: 'revoked' };
}
