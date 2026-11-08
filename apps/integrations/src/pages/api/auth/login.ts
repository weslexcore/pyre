// Step one of sign-in: the login form POSTs an email, and Supabase mails that
// address a magic link (back to /api/auth/callback) plus a 6-digit code.
// Sign-up is closed (shouldCreateUser: false), so only an address with an
// auth user — someone added on /admin/users — gets anything; an unknown
// address gets the same 200, and no mail, so the form cannot be used to
// find out who is on staff. Where to land afterwards is remembered in a
// short-lived cookie the callback and the code route read back.

import type { APIRoute } from 'astro';
import { assertSameOrigin } from '@/lib/auth/admin';
import { EMAIL_RE, isUnknownUserError, rememberReturnUrl, safeReturnUrl } from '@/lib/auth/login';
import { normalizeEmail } from '@/lib/email/address';
import { json, readJsonBody } from '@/lib/http/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
  if (!EMAIL_RE.test(email)) return json({ error: 'Enter your email address' }, 400);

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return json({ error: 'Sign-in is not configured' }, 503);

  rememberReturnUrl(cookies, safeReturnUrl(body.returnUrl));

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      // The link comes back to this deployment (preview, staging, prod),
      // provided its origin is on the project's redirect allowlist.
      emailRedirectTo: `${url.origin}/api/auth/callback`,
    },
  });

  if (error) {
    if (error.status === 429) {
      return json({ error: 'Too many attempts. Wait a minute and try again.' }, 429);
    }
    if (!isUnknownUserError(error)) {
      console.error('[Auth] signInWithOtp failed:', error.message);
      return json({ error: 'Could not send a sign-in link. Try again in a moment.' }, 502);
    }
    // Not a team member: same answer as for one.
  }

  return json({ ok: true });
};
