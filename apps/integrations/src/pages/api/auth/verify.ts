// The 6-digit code from the sign-in email, typed into the login form. Same
// outcome as clicking the link: Supabase verifies it, the session cookies
// ride back on this response, and the form navigates to redirectTo.

import type { APIRoute } from 'astro';
import { assertSameOrigin } from '@/lib/auth/admin';
import { afterSignIn, EMAIL_RE, takeReturnUrl } from '@/lib/auth/login';
import { normalizeEmail } from '@/lib/email/address';
import { json, readJsonBody } from '@/lib/http/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
  if (!EMAIL_RE.test(email)) return json({ error: 'Enter your email address' }, 400);
  const token = String(body.token ?? '').replace(/\D/g, '');
  if (token.length !== 6) return json({ error: 'Enter the 6-digit code from the email' }, 400);

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return json({ error: 'Sign-in is not configured' }, 503);

  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error || !data.user) {
    return json({ error: 'That code did not work. Check it, or request a new link.' }, 400);
  }

  await afterSignIn(data.user);
  return json({ redirectTo: takeReturnUrl(cookies) });
};
