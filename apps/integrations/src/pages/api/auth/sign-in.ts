// Email-first sign-in, step 2: email + password against Supabase Auth. The
// session cookie is written by the server client (lib/supabase/server.ts).
// Access is checked afterwards by the middleware / login page as usual — a
// valid password with no dashboard access lands on "Unauthorized".

import type { APIRoute } from 'astro';
import { assertSameOrigin } from '@/lib/auth/admin';
import { clearAuthCookies } from '@/lib/auth/cookies';
import { normalizeEmail } from '@/lib/auth/provision';
import { safeReturnUrl, withReturnUrl } from '@/lib/auth/return-url';
import { clientIp, isRateLimited } from '@/lib/boards/form-guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect, clientAddress }) => {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const form = await request.formData();
  const returnUrl = safeReturnUrl(String(form.get('returnUrl') ?? ''));
  const email = normalizeEmail(form.get('email'));
  const password = String(form.get('password') ?? '');
  const back = (error: string) =>
    redirect(withReturnUrl('/', returnUrl, { step: 'password', email, error }), 303);

  if (!email || !password) return back('invalid_credentials');

  const ip = clientIp(request, () => clientAddress);
  if (await isRateLimited(`auth:rl:sign-in:${ip}`, 20, 600)) return back('rate_limited');

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return back('unavailable');

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Wrong password, unknown email, and banned all read the same.
    console.info('[Auth] Password sign-in failed:', error.code ?? error.message);
    return back('invalid_credentials');
  }

  // Any leftover Momence session is superseded.
  clearAuthCookies(cookies);
  return redirect(returnUrl, 303);
};
