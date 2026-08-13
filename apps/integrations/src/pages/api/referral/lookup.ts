import type { APIRoute } from 'astro';
import { isReferralAuthorized } from '@/lib/referral/api-auth';
import { getTier, lookupReferrerByCode } from '@/lib/referral/registry';

export const prerender = false;

// Code lookup for the landing page's /r/{code} SSR render: enough to say
// "Wes gave you 15% off", nothing more. Server-to-server only (Bearer auth) so
// the codes aren't enumerable from a browser.

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!isReferralAuthorized(request)) {
    return json(401, { error: 'Unauthorized' });
  }

  const code = url.searchParams.get('code')?.trim() ?? '';
  if (!code) return json(400, { error: 'Missing code' });

  const lookup = await lookupReferrerByCode(code);
  if (lookup.status === 'unavailable') return json(503, { error: 'storage-unavailable' });
  if (lookup.status === 'unknown' || lookup.status === 'disabled') {
    // Disabled looks identical to unknown from outside: the page 404s either
    // way, and the difference is nobody's business but the admin queue's.
    return json(404, { error: 'unknown-code' });
  }

  const tier = await getTier(lookup.referrer.discount_percent);
  return json(200, {
    code: lookup.referrer.code,
    displayName: lookup.referrer.display_name,
    discountLabel: tier?.label ?? `${lookup.referrer.discount_percent}%`,
    referrerType: lookup.referrer.referrer_type,
  });
};
