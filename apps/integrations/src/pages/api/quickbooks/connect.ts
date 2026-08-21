// Step 1 of the QuickBooks OAuth flow: send the admin to Intuit's consent
// screen. The random `state` rides an httpOnly cookie so the callback can
// reject forged redirects.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { buildAuthorizationUrl, generateState, QBO_STATE_COOKIE } from '@/lib/quickbooks/oauth';

export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const state = generateState();
  cookies.set(QBO_STATE_COOKIE, state, {
    path: '/api/quickbooks',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: 600,
  });

  return redirect(buildAuthorizationUrl(url, state), 302);
};
