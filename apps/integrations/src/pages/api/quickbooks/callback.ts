// Step 2 of the QuickBooks OAuth flow: Intuit redirects back here with
// ?code=&realmId=&state=. Verify state against the cookie, exchange the code
// for tokens (Basic-authenticated POST to Intuit's token endpoint), and
// persist them against the realm.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { exchangeCodeForTokens, QBO_STATE_COOKIE } from '@/lib/quickbooks/oauth';
import { saveConnection } from '@/lib/quickbooks/store';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const expectedState = cookies.get(QBO_STATE_COOKIE)?.value;
  cookies.delete(QBO_STATE_COOKIE, { path: '/api/quickbooks' });

  // Intuit reports consent-screen failures (e.g. access_denied) in ?error=.
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    return new Response(JSON.stringify({ error: `Intuit returned: ${oauthError}` }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');

  if (!code || !realmId) {
    return new Response(JSON.stringify({ error: 'Missing code or realmId' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }
  if (!state || !expectedState || state !== expectedState) {
    return new Response(JSON.stringify({ error: 'State mismatch; restart the connect flow' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const tokens = await exchangeCodeForTokens(url, code);
    await saveConnection(realmId, tokens, gate.user.email || undefined);

    return new Response(
      JSON.stringify({
        connected: true,
        realmId,
        accessTokenExpiresAt: new Date(tokens.accessTokenExpiresAt).toISOString(),
        refreshTokenExpiresAt: new Date(tokens.refreshTokenExpiresAt).toISOString(),
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[QuickBooks] callback failed:', error);
    return new Response(JSON.stringify({ error: 'Token exchange failed; see server logs' }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }
};
