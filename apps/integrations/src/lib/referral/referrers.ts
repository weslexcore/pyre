// Referrer creation. Members become referrers lazily — the first visit to the
// /account referral card (or an admin action) creates the row and mints the
// code. Partner referrers are always admin-created against an existing
// partners row.

import { createWebhookLogger } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import { getDb, type ReferrerRow } from '@/lib/db';
import { getPartner } from '@/lib/partner/registry';
import { codeCandidates, isValidCode, normalizeCode } from './codes';
import { getReferrerByMemberId } from './registry';

const log = createWebhookLogger('Referrals');

export type GetOrCreateResult =
  | { outcome: 'found'; referrer: ReferrerRow }
  | { outcome: 'created'; referrer: ReferrerRow }
  | { outcome: 'unavailable'; reason: string };

/**
 * The member's referrer row, minting one (with a fresh code) if absent.
 * Insert races resolve via the unique index on momence_member_id: the loser
 * re-reads the winner's row.
 */
export async function getOrCreateMemberReferrer(params: {
  momenceMemberId: number;
  email: string;
  firstName: string;
}): Promise<GetOrCreateResult> {
  const db = getDb();
  if (!db) return { outcome: 'unavailable', reason: 'db-not-configured' };

  const existing = await getReferrerByMemberId(params.momenceMemberId);
  if (existing) return { outcome: 'found', referrer: existing };

  const email = params.email.trim().toLowerCase();
  const displayName = params.firstName.trim() || 'A friend';

  for (const code of codeCandidates(params.firstName)) {
    const { data, error } = await db
      .from('referrers')
      .insert({
        referrer_type: 'member',
        momence_member_id: params.momenceMemberId,
        email,
        display_name: displayName,
        code,
      })
      .select('*')
      .single<ReferrerRow>();

    if (data) {
      await captureEvent({
        distinctId: email,
        event: 'referral_code_created',
        properties: { code, referrer_type: 'member' },
      });
      return { outcome: 'created', referrer: data };
    }

    if (error?.code === '23505') {
      // Either the code collided (try the next candidate) or a concurrent
      // request already created this member's row (return it).
      const raced = await getReferrerByMemberId(params.momenceMemberId);
      if (raced) return { outcome: 'found', referrer: raced };
      continue;
    }

    log.error('Referrer insert failed', error);
    return { outcome: 'unavailable', reason: 'db-insert-failed' };
  }

  log.error(`Ran out of code candidates for member ${params.momenceMemberId}`);
  return { outcome: 'unavailable', reason: 'code-generation-exhausted' };
}

export type CreatePartnerReferrerResult =
  | { outcome: 'created'; referrer: ReferrerRow }
  | { outcome: 'exists'; referrer: ReferrerRow }
  | { outcome: 'unavailable'; reason: string };

/**
 * Admin-created referrer for a partner business. The code is chosen by the
 * admin (e.g. BFT15 to match the printed voucher cards).
 */
export async function createPartnerReferrer(params: {
  partnerSlug: string;
  code: string;
  discountPercent?: number;
  createdBy: string;
}): Promise<CreatePartnerReferrerResult> {
  const db = getDb();
  if (!db) return { outcome: 'unavailable', reason: 'db-not-configured' };

  const partner = await getPartner(params.partnerSlug);
  if (!partner) return { outcome: 'unavailable', reason: 'unknown-partner' };

  const code = normalizeCode(params.code);
  if (!isValidCode(code)) return { outcome: 'unavailable', reason: 'invalid-code' };

  const { data, error } = await db
    .from('referrers')
    .insert({
      referrer_type: 'partner',
      partner_slug: partner.slug,
      display_name: partner.name,
      code,
      ...(params.discountPercent != null && { discount_percent: params.discountPercent }),
      created_by: params.createdBy,
    })
    .select('*')
    .single<ReferrerRow>();

  if (data) {
    await captureEvent({
      distinctId: partner.slug,
      event: 'referral_code_created',
      properties: { code, referrer_type: 'partner', partner: partner.slug },
    });
    return { outcome: 'created', referrer: data };
  }

  if (error?.code === '23505') {
    // Distinguish "this partner already has a code" from "that code is taken".
    const { data: existing } = await db
      .from('referrers')
      .select('*')
      .eq('partner_slug', partner.slug)
      .maybeSingle<ReferrerRow>();
    if (existing) return { outcome: 'exists', referrer: existing };
    return { outcome: 'unavailable', reason: 'code-taken' };
  }

  // FK violation on discount_percent = tier missing. Surface it as its own
  // reason so the admin UI can say "create the tier first".
  if (error?.code === '23503') return { outcome: 'unavailable', reason: 'unknown-tier' };

  log.error('Partner referrer insert failed', error);
  return { outcome: 'unavailable', reason: 'db-insert-failed' };
}
