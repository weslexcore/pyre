// Step 2 of the QuickBooks OAuth flow: Intuit redirects back here with
// ?code=&realmId=&state=. Verify state against the cookie, exchange the code
// for tokens (Basic-authenticated POST to Intuit's token endpoint), and
// persist them against the realm.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { json } from '@/lib/http/route';
import { exchangeCodeForTokens, QBO_STATE_COOKIE } from '@/lib/quickbooks/oauth';
import { saveConnection } from '@/lib/quickbooks/store';

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const expectedState = cookies.get(QBO_STATE_COOKIE)?.value;
  cookies.delete(QBO_STATE_COOKIE, { path: '/api/quickbooks' });

  // Intuit reports consent-screen failures (e.g. access_denied) in ?error=.
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    return json({ error: `Intuit returned: ${oauthError}` }, 400);
  }

  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');

  if (!code || !realmId) {
    return json({ error: 'Missing code or realmId' }, 400);
  }
  if (!state || !expectedState || state !== expectedState) {
    return json({ error: 'State mismatch; restart the connect flow' }, 400);
  }

  try {
    const tokens = await exchangeCodeForTokens(url, code);
    await saveConnection(realmId, tokens, gate.user.email || undefined);

    return json({
      connected: true,
      realmId,
      accessTokenExpiresAt: new Date(tokens.accessTokenExpiresAt).toISOString(),
      refreshTokenExpiresAt: new Date(tokens.refreshTokenExpiresAt).toISOString(),
    });
  } catch (error) {
    console.error('[QuickBooks] callback failed:', error);
    return json({ error: 'Token exchange failed; see server logs' }, 502);
  }
};
