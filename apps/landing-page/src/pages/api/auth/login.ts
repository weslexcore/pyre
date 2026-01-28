// OAuth login endpoint
// Generates state, stores it in cookie, and redirects to Momence

import type { APIRoute } from 'astro';
import { setOAuthState } from '@/lib/auth-cookies';
import { buildAuthorizationUrl, generateState } from '@/lib/momence-oauth';
import type { OAuthPrompt } from '@/lib/momence-oauth-types';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  console.log('[OAuth Login] Starting login flow...');

  // Check for signup parameter to determine prompt type
  const signup = url.searchParams.get('signup') === 'true';
  const prompt: OAuthPrompt = signup ? 'sign-up' : 'login';
  console.log('[OAuth Login] Prompt type:', prompt);

  // Get optional return URL (where to redirect after successful auth)
  const returnUrl = url.searchParams.get('returnUrl') || '/account';
  console.log('[OAuth Login] Return URL:', returnUrl);

  // Generate cryptographically secure state for CSRF protection
  const state = generateState();
  console.log('[OAuth Login] Generated state:', state);

  // Store state in secure cookie
  setOAuthState(cookies, {
    state,
    returnUrl,
  });
  console.log('[OAuth Login] State stored in cookie');

  // Build Momence authorization URL
  const authUrl = buildAuthorizationUrl(url, state, prompt, returnUrl);
  console.log('[OAuth Login] Redirecting to:', authUrl);

  // Redirect to Momence for authentication
  return redirect(authUrl, 302);
};
