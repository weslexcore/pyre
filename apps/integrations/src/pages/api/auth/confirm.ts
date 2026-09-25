// Landing point for emailed set-password links (lib/auth/provision.ts
// sendPasswordLink). Verifies the one-time token server-side, which signs the
// person in (session cookie via lib/supabase/server.ts), then sends them to
// choose a password.

import type { EmailOtpType } from '@supabase/supabase-js';
import type { APIRoute } from 'astro';
import { clearAuthCookies } from '@/lib/auth/cookies';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

const LINK_TYPES = new Set<EmailOtpType>(['invite', 'recovery', 'magiclink', 'email']);

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;

  if (!tokenHash || !type || !LINK_TYPES.has(type)) {
    return redirect('/forgot-password?error=invalid_link', 302);
  }

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return redirect('/forgot-password?error=unavailable', 302);

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    console.info('[Auth] Link verification failed:', error.code ?? error.message);
    return redirect('/forgot-password?error=expired_link', 302);
  }

  clearAuthCookies(cookies);
  return redirect('/set-password?mode=reset', 302);
};
