// OAuth login: generate CSRF state, stash it in a cookie, redirect to Momence.
// Port of the landing-page flow, scoped to the admin dashboard (no sign-up
// prompt — admins already have Momence accounts).

import type { APIRoute } from 'astro';
import { setOAuthState } from '@/lib/auth/cookies';
import { buildAuthorizationUrl, generateState } from '@/lib/auth/momence-oauth';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const returnUrl = url.searchParams.get('returnUrl') || '/admin';
  const state = generateState();

  setOAuthState(cookies, { state, returnUrl });

  return redirect(buildAuthorizationUrl(url, state), 302);
};
