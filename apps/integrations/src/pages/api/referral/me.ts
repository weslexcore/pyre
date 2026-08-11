import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { findMemberByEmail } from '@/lib/momence/host-api';
import { isReferralAuthorized } from '@/lib/referral/api-auth';
import { getReferralClicks } from '@/lib/referral/codes';
import { getOrCreateMemberReferrer } from '@/lib/referral/referrers';
import { referralUrl } from '@/lib/referral/registry';

export const prerender = false;

// The /account referral card's data source: get-or-create the logged-in
// member's referrer row and return their code + stats. Called server-to-server
// by the landing page (which owns the Momence OAuth session); the member is
// resolved by email through the HOST api because the OAuth profile id is not
// guaranteed to be the host member id the webhooks report.
//
// Get-or-create is deliberate: every member who opens the card becomes a
// referrer with a live code, no signup step.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!isReferralAuthorized(request)) {
    return json(401, { error: 'Unauthorized' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  if (!EMAIL_RE.test(email)) return json(400, { error: 'Invalid email' });

  try {
    const member = await findMemberByEmail(email);
    if (!member) return json(404, { error: 'member-not-found' });

    const result = await getOrCreateMemberReferrer({
      momenceMemberId: member.id,
      email,
      firstName: firstName || member.firstName,
    });
    if (result.outcome === 'unavailable') return json(503, { error: result.reason });
    const referrer = result.referrer;

    const db = getDb();
    let redemptions = 0;
    let conversions = 0;
    let rewardsEarned = 0;
    let rewardsActive = 0;
    if (db) {
      const [{ count: redeemedCount }, { count: convertedCount }, { data: rewards }] =
        await Promise.all([
          db
            .from('referral_redemptions')
            .select('id', { count: 'exact', head: true })
            .eq('referrer_id', referrer.id)
            .in('status', ['redeemed', 'converted']),
          db
            .from('referral_redemptions')
            .select('id', { count: 'exact', head: true })
            .eq('referrer_id', referrer.id)
            .eq('status', 'converted'),
          db.from('referral_rewards').select('status').eq('referrer_id', referrer.id),
        ]);
      redemptions = redeemedCount ?? 0;
      conversions = convertedCount ?? 0;
      rewardsEarned = rewards?.length ?? 0;
      rewardsActive = rewards?.filter((r) => r.status === 'granted').length ?? 0;
    }

    return json(200, {
      code: referrer.code,
      url: referralUrl(referrer.code),
      discountPercent: referrer.discount_percent,
      enabled: referrer.enabled,
      stats: {
        clicks: await getReferralClicks(referrer.code),
        redemptions,
        conversions,
        rewardsEarned,
        rewardsActive,
      },
    });
  } catch (error) {
    console.error('[Referral] /me failed', error);
    return json(502, { error: 'Request failed' });
  }
};
