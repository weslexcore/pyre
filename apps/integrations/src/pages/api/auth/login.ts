// Momence OAuth login — now only the cutover path: staff without a Supabase
// password prove who they are through Momence, then set one (the callback
// sends them to /set-password). Reached from the email-first login page
// (/api/auth/identify), which passes the typed email along so /set-password
// can point out a different Momence account. Gone once AUTH_MOMENCE_LOGIN=off.

import type { APIRoute } from 'astro';
import { setOAuthState } from '@/lib/auth/cookies';
import { buildAuthorizationUrl, generateState } from '@/lib/auth/momence-oauth';
import { normalizeEmail } from '@/lib/auth/provision';
import { safeReturnUrl, withReturnUrl } from '@/lib/auth/return-url';
import { momenceLoginEnabled } from '@/lib/auth/session';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const returnUrl = safeReturnUrl(url.searchParams.get('returnUrl'));
  if (!momenceLoginEnabled()) return redirect(withReturnUrl('/', returnUrl), 302);

  const state = generateState();
  const email = normalizeEmail(url.searchParams.get('email')) || undefined;

  setOAuthState(cookies, { state, returnUrl, email });

  return redirect(buildAuthorizationUrl(url, state), 302);
};
