import type { APIRoute } from 'astro';
import { json } from '@/lib/http/route';
import { isReferralAuthorized } from '@/lib/referral/api-auth';
import { lookupReferrerByCode } from '@/lib/referral/registry';

export const prerender = false;

// Code lookup for the landing page's /r/{code} SSR render: enough to say
// "Wes gave you 15% off", nothing more. Server-to-server only (Bearer auth) so
// the codes aren't enumerable from a browser.

export const GET: APIRoute = async ({ request, url }) => {
  if (!isReferralAuthorized(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const code = url.searchParams.get('code')?.trim() ?? '';
  if (!code) return json({ error: 'Missing code' }, 400);

  const lookup = await lookupReferrerByCode(code);
  if (lookup.status === 'unavailable') return json({ error: 'storage-unavailable' }, 503);
  if (lookup.status === 'unknown' || lookup.status === 'disabled') {
    // Disabled looks identical to unknown from outside: the page 404s either
    // way, and the difference is nobody's business but the admin queue's.
    return json({ error: 'unknown-code' }, 404);
  }

  return json(
    {
      code: lookup.referrer.code,
      displayName: lookup.referrer.display_name,
      discountPercent: lookup.referrer.discount_percent,
      referrerType: lookup.referrer.referrer_type,
    },
    200
  );
};
