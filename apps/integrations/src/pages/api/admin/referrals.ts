// The referral program's admin API behind /admin/referrals: referrer registry
// (members + partners), the redemption queue, the reward ledger, and the tier
// map. Reads need the page grant; every mutation needs admin or
// referrals:manage because they all end in a Momence tag change.
//
// There is no DELETE anywhere: redemption and reward rows are the audit trail,
// and referrer rows anchor them.

import type { APIRoute } from 'astro';
import { REFERRALS_MANAGE } from '@/components/admin/adminTools';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import {
  getDb,
  type ReferralRedemptionRow,
  type ReferralRewardRow,
  type ReferralTierRow,
  type ReferrerRow,
} from '@/lib/db';
import { findMemberByEmail, getTagIdByName, invalidateTagCache } from '@/lib/momence/host-api';
import { revokeRedemption, revokeReward } from '@/lib/referral/admin-actions';
import { createPartnerReferrer, getOrCreateMemberReferrer } from '@/lib/referral/referrers';
import { getRewardTagName, invalidateTierCache } from '@/lib/referral/registry';

export const prerender = false;

const PAGE = '/admin/referrals';
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const REDEMPTION_STATUSES = ['pending', 'redeemed', 'converted', 'expired', 'revoked'] as const;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT)
  );

  let referrerQuery = db
    .from('referrers')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  const q = url.searchParams.get('q')?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    referrerQuery = referrerQuery.or(
      `code.ilike.${like},display_name.ilike.${like},email.ilike.${like},partner_slug.ilike.${like}`
    );
  }

  let redemptionQuery = db
    .from('referral_redemptions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  const status = url.searchParams.get('status');
  if (status) {
    const wanted = status
      .split(',')
      .map((s) => s.trim())
      .filter((s) => (REDEMPTION_STATUSES as readonly string[]).includes(s));
    if (wanted.length > 0) redemptionQuery = redemptionQuery.in('status', wanted);
  }

  const [
    { data: referrers, error: referrersError },
    { data: redemptions },
    { data: rewards },
    { data: tiers },
    { data: allStatuses },
  ] = await Promise.all([
    referrerQuery,
    redemptionQuery,
    db.from('referral_rewards').select('*').order('granted_at', { ascending: false }).limit(limit),
    db.from('referral_tiers').select('*').order('percent'),
    db.from('referral_redemptions').select('status'),
  ]);
  if (referrersError) return json({ error: referrersError.message }, 500);

  const counts: Record<string, number> = {};
  for (const row of (allStatuses ?? []) as { status: string }[]) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  // Does each tier's Momence tag (and the reward tag) actually exist? null =
  // couldn't check. Same nag the partners page gives, cheap via the cached map.
  const rewardTagName = getRewardTagName();
  const tagStatus: Record<string, boolean | null> = {};
  for (const tagName of [...(tiers ?? []).map((t) => t.tag_name), rewardTagName]) {
    try {
      tagStatus[tagName] = (await getTagIdByName(tagName)) !== null;
    } catch {
      tagStatus[tagName] = null;
    }
  }

  return json({
    referrers: (referrers ?? []) as ReferrerRow[],
    redemptions: (redemptions ?? []) as ReferralRedemptionRow[],
    rewards: (rewards ?? []) as ReferralRewardRow[],
    tiers: (tiers ?? []) as ReferralTierRow[],
    rewardTagName,
    tagStatus,
    counts,
    canManage: gate.access.isAdmin || gate.access.pages.includes(REFERRALS_MANAGE),
  });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;
  if (!gate.access.isAdmin && !gate.access.pages.includes(REFERRALS_MANAGE)) {
    return json({ error: 'Forbidden' }, 403);
  }
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Expected application/json' }, 415);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const actorEmail = (gate.user.email ?? '').toLowerCase();
  const action = String(body.action ?? '');

  try {
    switch (action) {
      case 'create-member-referrer': {
        const email = String(body.email ?? '')
          .trim()
          .toLowerCase();
        if (!email) return json({ error: 'Missing email' }, 400);
        const member = await findMemberByEmail(email);
        if (!member) return json({ error: `No Momence member found for ${email}` }, 404);
        const result = await getOrCreateMemberReferrer({
          momenceMemberId: member.id,
          email,
          firstName: member.firstName,
        });
        if (result.outcome === 'unavailable') return json({ error: result.reason }, 503);
        return json({ ok: true, referrer: result.referrer, existed: result.outcome === 'found' });
      }

      case 'create-partner-referrer': {
        const partnerSlug = String(body.partnerSlug ?? '').trim();
        const code = String(body.code ?? '').trim();
        if (!partnerSlug || !code) return json({ error: 'Missing partner or code' }, 400);
        const discountPercent = Number(body.discountPercent);
        const result = await createPartnerReferrer({
          partnerSlug,
          code,
          ...(Number.isFinite(discountPercent) && { discountPercent }),
          createdBy: actorEmail,
        });
        if (result.outcome === 'unavailable') {
          const messages: Record<string, string> = {
            'unknown-partner': 'No such partner — add it on /admin/partners first',
            'invalid-code': 'Codes are 3-16 letters/digits',
            'code-taken': 'That code is already in use',
            'unknown-tier': 'No tier for that percent — create the tier first',
          };
          return json({ error: messages[result.reason] ?? result.reason }, 400);
        }
        return json({ ok: true, referrer: result.referrer, existed: result.outcome === 'exists' });
      }

      case 'update-referrer': {
        const id = String(body.id ?? '');
        if (!id) return json({ error: 'Missing id' }, 400);
        const patch: Record<string, unknown> = { updated_by: actorEmail };
        if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
        if (body.discountPercent != null) {
          const percent = Number(body.discountPercent);
          if (!Number.isFinite(percent)) return json({ error: 'Invalid percent' }, 400);
          patch.discount_percent = percent;
        }
        if (typeof body.notes === 'string') patch.notes = body.notes.trim() || null;
        const { data, error } = await db
          .from('referrers')
          .update(patch)
          .eq('id', id)
          .select('*')
          .maybeSingle<ReferrerRow>();
        if (error) {
          // FK violation = tier missing for the requested percent.
          if (error.code === '23503') {
            return json({ error: 'No tier for that percent — create the tier first' }, 400);
          }
          return json({ error: error.message }, 500);
        }
        if (!data) return json({ error: 'No such referrer' }, 404);
        return json({ ok: true, referrer: data });
      }

      case 'create-tier': {
        const percent = Number(body.percent);
        const tagName = String(body.tagName ?? '').trim();
        if (!Number.isFinite(percent) || percent <= 0 || percent >= 100 || !tagName) {
          return json({ error: 'Tier needs a percent (1-99) and a Momence tag name' }, 400);
        }
        const { data, error } = await db
          .from('referral_tiers')
          .insert({ percent, tag_name: tagName })
          .select('*')
          .single<ReferralTierRow>();
        if (error) {
          if (error.code === '23505')
            return json({ error: 'That percent or tag already exists' }, 409);
          return json({ error: error.message }, 500);
        }
        invalidateTierCache();
        await invalidateTagCache();
        return json({ ok: true, tier: data });
      }

      case 'toggle-tier': {
        const percent = Number(body.percent);
        const enabled = Boolean(body.enabled);
        const { data, error } = await db
          .from('referral_tiers')
          .update({ enabled })
          .eq('percent', percent)
          .select('*')
          .maybeSingle<ReferralTierRow>();
        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ error: 'No such tier' }, 404);
        invalidateTierCache();
        return json({ ok: true, tier: data });
      }

      case 'revoke-redemption': {
        const id = String(body.id ?? '');
        if (!id) return json({ error: 'Missing id' }, 400);
        const result = await revokeRedemption(
          id,
          actorEmail,
          typeof body.reason === 'string' ? body.reason : undefined
        );
        if (result.outcome === 'not-found') return json({ error: 'No such redemption' }, 404);
        if (result.outcome === 'not-revocable') {
          return json({ error: `Already ${result.status} — nothing to revoke` }, 409);
        }
        return json({ ok: true });
      }

      case 'revoke-reward': {
        const id = String(body.id ?? '');
        if (!id) return json({ error: 'Missing id' }, 400);
        const result = await revokeReward(id, actorEmail);
        if (result.outcome === 'not-found') return json({ error: 'No such reward' }, 404);
        if (result.outcome === 'not-revocable') {
          return json({ error: `Already ${result.status} — nothing to revoke` }, 409);
        }
        return json({ ok: true });
      }

      case 'refresh-tag-cache': {
        await invalidateTagCache();
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action: ${action || '(none)'}` }, 400);
    }
  } catch (error) {
    console.error('[admin/referrals] Action failed', error);
    return json({ error: error instanceof Error ? error.message : 'Action failed' }, 500);
  }
};
