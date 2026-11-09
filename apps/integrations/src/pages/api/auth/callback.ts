// The magic link lands here: verify its token hash with Supabase (which sets
// the session cookies through lib/supabase/server), link the staff row on a
// first sign-in, and send the person where they were headed. Any failure
// goes back to the login page with a code it can explain.

import type { APIRoute } from 'astro';
import { afterSignIn, loginRedirect, takeReturnUrl } from '@/lib/auth/login';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const returnUrl = takeReturnUrl(cookies);
  const fail = (code: string) => redirect(loginRedirect(returnUrl, code), 302);

  // Supabase reports a dead link on the redirect itself (error_code=otp_expired).
  const errorCode = url.searchParams.get('error_code') ?? url.searchParams.get('error');
  if (errorCode) {
    console.warn('[Auth] Callback error:', errorCode, url.searchParams.get('error_description'));
    return fail(errorCode === 'otp_expired' ? 'link_expired' : 'auth_failed');
  }

  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (!tokenHash || type !== 'email') return fail('invalid_callback');

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return fail('auth_failed');

  const { data, error } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
  if (error || !data.user) {
    console.warn('[Auth] Link verification failed:', error?.message ?? 'no user');
    return fail('link_expired');
  }

  await afterSignIn(data.user);
  return redirect(returnUrl, 302);
};
