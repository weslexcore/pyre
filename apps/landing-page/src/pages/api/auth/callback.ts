// OAuth callback endpoint
// Handles the redirect from Momence after authentication

import type { APIRoute } from 'astro';
import { getAndClearOAuthState, setAuthTokens } from '@/lib/auth-cookies';
import { exchangeCodeForTokens } from '@/lib/momence-oauth';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  console.log('[OAuth Callback] Received callback request');
  console.log('[OAuth Callback] Full URL:', url.toString());
  console.log('[OAuth Callback] Search params:', Object.fromEntries(url.searchParams.entries()));

  // Get authorization code and state from query params
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Handle OAuth errors from Momence
  if (error) {
    console.error('[OAuth Callback] Error from Momence:', error, errorDescription);
    const errorUrl = new URL('/account', url.origin);
    errorUrl.searchParams.set('error', 'auth_failed');
    errorUrl.searchParams.set('error_description', errorDescription || error);
    return redirect(errorUrl.toString(), 302);
  }

  // Validate required parameters
  if (!code || !state) {
    console.error('[OAuth Callback] Missing code or state. Code:', !!code, 'State:', !!state);
    return redirect('/account?error=invalid_callback', 302);
  }

  console.log('[OAuth Callback] Got code (first 10 chars):', code.substring(0, 10) + '...');
  console.log('[OAuth Callback] Got state:', state);

  // Retrieve and validate stored state
  const storedState = getAndClearOAuthState(cookies);
  console.log('[OAuth Callback] Stored state from cookie:', storedState);

  if (!storedState) {
    console.error('[OAuth Callback] No stored state found in cookies');
    return redirect('/account?error=state_mismatch', 302);
  }

  if (storedState.state !== state) {
    console.error('[OAuth Callback] State mismatch. Expected:', storedState.state, 'Got:', state);
    return redirect('/account?error=state_mismatch', 302);
  }

  console.log('[OAuth Callback] State validated, exchanging code for tokens...');

  try {
    // Exchange authorization code for tokens
    const tokens = await exchangeCodeForTokens(url, code);
    console.log('[OAuth Callback] Token exchange successful');
    console.log('[OAuth Callback] Token expiresAt:', tokens.expiresAt);
    if (tokens.expiresAt && !Number.isNaN(tokens.expiresAt)) {
      console.log('[OAuth Callback] Expires at:', new Date(tokens.expiresAt).toISOString());
    }

    // Store tokens in secure cookies
    setAuthTokens(cookies, tokens);
    console.log('[OAuth Callback] Tokens stored in cookies');

    console.info('[OAuth Callback] Authentication successful');

    // Redirect to the stored return URL or default to /account
    // Add auth=success parameter to signal fresh authentication (bypasses stale cache)
    const returnUrl = storedState.returnUrl || '/account';
    const redirectUrl = new URL(returnUrl, url.origin);
    redirectUrl.searchParams.set('auth', 'success');
    console.log('[OAuth Callback] Redirecting to:', redirectUrl.toString());
    return redirect(redirectUrl.toString(), 302);
  } catch (err) {
    console.error('[OAuth Callback] Token exchange failed:', err);
    console.error(
      '[OAuth Callback] Error details:',
      err instanceof Error ? err.message : String(err)
    );
    if (err instanceof Error && err.stack) {
      console.error('[OAuth Callback] Stack:', err.stack);
    }
    return redirect('/account?error=token_exchange_failed', 302);
  }
};
