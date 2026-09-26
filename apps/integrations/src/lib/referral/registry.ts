// Referrer + tier registry for the referral program. Source of truth is the
// `referrers` / `referral_tiers` tables (managed from /admin/referrals and
// grown implicitly by /api/referral/me get-or-create). Same brief in-process
// cache shape as lib/partner/registry.ts — but keyed lookups hit the DB
// directly because referrers, unlike partners, are unbounded (every /account
// visitor becomes one).

import { cachedQuery } from '@/lib/cached-query';
import { getDb, type ReferralTierRow, type ReferrerRow } from '@/lib/db';
import { siteOrigin } from '@/lib/origins';

// A stale tier map beats treating a query error as "no tiers" — that would
// reject every redemption.
const tierCache = cachedQuery(async () => {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db.from('referral_tiers').select('*').order('percent');
  if (error) {
    console.error('[referrals] tier fetch failed:', error.message);
    return null;
  }
  return data as ReferralTierRow[];
});

export function invalidateTierCache(): void {
  tierCache.invalidate();
}

/** All tier rows (cached ~30s), or null when Supabase is down. */
export function listTiers(force = false): Promise<ReferralTierRow[] | null> {
  return tierCache.get(force);
}

/** The tier a referrer's friends get, or null when unknown/unavailable. */
export async function getTier(percent: number): Promise<ReferralTierRow | null> {
  const tiers = await listTiers();
  return tiers?.find((t) => t.percent === percent) ?? null;
}

export type ReferrerLookup =
  | { status: 'found'; referrer: ReferrerRow }
  | { status: 'disabled'; referrer: ReferrerRow }
  | { status: 'unknown' }
  | { status: 'unavailable' };

/**
 * Intake-path lookup by code. Keeps "no such code" (404 on the landing page)
 * distinct from "storage is down" (503) — same contract as lookupPartner.
 */
export async function lookupReferrerByCode(code: string): Promise<ReferrerLookup> {
  const db = getDb();
  if (!db) return { status: 'unavailable' };

  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,16}$/.test(normalized)) return { status: 'unknown' };

  const { data, error } = await db
    .from('referrers')
    .select('*')
    .eq('code', normalized)
    .maybeSingle<ReferrerRow>();
  if (error) {
    console.error('[referrals] code lookup failed:', error.message);
    return { status: 'unavailable' };
  }
  if (!data) return { status: 'unknown' };
  return data.enabled
    ? { status: 'found', referrer: data }
    : { status: 'disabled', referrer: data };
}

/** The referrer row behind a Momence member id, enabled or not. */
export async function getReferrerByMemberId(momenceMemberId: number): Promise<ReferrerRow | null> {
  const db = getDb();
  if (!db) return null;

  const { data, error } = await db
    .from('referrers')
    .select('*')
    .eq('momence_member_id', momenceMemberId)
    .maybeSingle<ReferrerRow>();
  if (error) {
    console.error('[referrals] member lookup failed:', error.message);
    return null;
  }
  return data;
}

/** The referrer row by primary key, enabled or not. */
export async function getReferrer(id: string): Promise<ReferrerRow | null> {
  const db = getDb();
  if (!db) return null;

  const { data, error } = await db
    .from('referrers')
    .select('*')
    .eq('id', id)
    .maybeSingle<ReferrerRow>();
  if (error) {
    console.error('[referrals] referrer fetch failed:', error.message);
    return null;
  }
  return data;
}

/**
 * The Momence tag carrying the referrer reward Price Rule. Like tier tags, the
 * tag and its rule are created by hand in the Momence dashboard.
 */
export function getRewardTagName(): string {
  return (
    import.meta.env.REFERRAL_REWARD_TAG_NAME ??
    process.env.REFERRAL_REWARD_TAG_NAME ??
    'referral-reward'
  );
}

/** How long a redeemed-but-unbooked discount lives before the sweep expires it. */
export function getRedemptionExpiryDays(): number {
  const raw = import.meta.env.REFERRAL_EXPIRY_DAYS ?? process.env.REFERRAL_EXPIRY_DAYS;
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

/** How long an unused referrer reward lives before the sweep expires it. */
export const REWARD_EXPIRY_DAYS = 90;

/** Where a code's shareable link points. */
export function referralUrl(code: string): string {
  const site = siteOrigin();
  return `${site}/r/${code}`;
}
