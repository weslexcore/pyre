// OAuth callback: validate CSRF state, exchange the code for tokens, set the
// Momence session cookies, and send the person to /set-password — during the
// Supabase cutover a Momence session is only good for creating the account.

import type { APIRoute } from 'astro';
import { getAndClearOAuthState, setAuthTokens } from '@/lib/auth/cookies';
import { exchangeCodeForTokens } from '@/lib/auth/momence-oauth';
import { withReturnUrl } from '@/lib/auth/return-url';

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
    return redirect('/?error=auth_failed', 302);
  }

  if (!code || !state) {
    return redirect('/?error=invalid_callback', 302);
  }

  const storedState = getAndClearOAuthState(cookies);
  if (!storedState || storedState.state !== state) {
    console.error('[OAuth Callback] State mismatch or missing state cookie');
    return redirect('/?error=state_mismatch', 302);
  }

  try {
    const tokens = await exchangeCodeForTokens(url, code);
    setAuthTokens(cookies, tokens);

    // `typed` lets /set-password flag a Momence account whose email differs
    // from the one entered on the login page.
    const extra: Record<string, string> = storedState.email ? { typed: storedState.email } : {};
    return redirect(withReturnUrl('/set-password', storedState.returnUrl ?? '/admin', extra), 302);
  } catch (err) {
    console.error('[OAuth Callback] Token exchange failed:', err);
    return redirect('/?error=token_exchange_failed', 302);
  }
};
