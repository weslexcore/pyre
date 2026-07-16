// OAuth callback: validate CSRF state, exchange the code for tokens, set the
// session cookies, and land back on the admin dashboard.

import type { APIRoute } from 'astro';
import { getAndClearOAuthState, setAuthTokens } from '@/lib/auth/cookies';
import { exchangeCodeForTokens } from '@/lib/auth/momence-oauth';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    console.error(
      '[OAuth Callback] Error from Momence:',
      error,
      url.searchParams.get('error_description')
    );
    return redirect('/admin?error=auth_failed', 302);
  }

  if (!code || !state) {
    return redirect('/admin?error=invalid_callback', 302);
  }

  const storedState = getAndClearOAuthState(cookies);
  if (!storedState || storedState.state !== state) {
    console.error('[OAuth Callback] State mismatch or missing state cookie');
    return redirect('/admin?error=state_mismatch', 302);
  }

  try {
    const tokens = await exchangeCodeForTokens(url, code);
    setAuthTokens(cookies, tokens);

    const returnUrl = storedState.returnUrl || '/admin';
    const redirectUrl = new URL(returnUrl, url.origin);
    redirectUrl.searchParams.set('auth', 'success');
    return redirect(redirectUrl.toString(), 302);
  } catch (err) {
    console.error('[OAuth Callback] Token exchange failed:', err);
    return redirect('/admin?error=token_exchange_failed', 302);
  }
};
