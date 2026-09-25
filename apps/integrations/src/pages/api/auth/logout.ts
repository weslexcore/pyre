// Logout: end the Supabase session (this device only) and clear any leftover
// Momence cutover cookies. The Momence session itself stays, as before.

import type { APIRoute } from 'astro';
import { clearAuthCookies } from '@/lib/auth/cookies';
import { safeReturnUrl } from '@/lib/auth/return-url';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const supabase = createSupabaseServerClient(cookies);
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) console.warn('[Auth] Supabase sign-out failed:', error.message);
  }
  clearAuthCookies(cookies);
  return redirect(safeReturnUrl(url.searchParams.get('returnUrl')), 302);
};
