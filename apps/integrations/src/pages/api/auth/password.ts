// Sign in with a password: one a person set on /admin/account after an email
// sign-in, for when the inbox is out of reach.
//
// Same rule as api/auth/login: someone who is not on staff gets the same answer
// as a wrong password, and Supabase is never asked, so the form cannot tell
// anyone who is on staff. finishSignIn then rechecks access on the user
// Supabase returns.

import type { APIRoute } from 'astro';
import { getAccess } from '@/lib/auth/access';
import { assertSameOrigin } from '@/lib/auth/admin';
import { EMAIL_RE, finishSignIn, safeReturnUrl } from '@/lib/auth/login';
import { normalizeEmail } from '@/lib/email/address';
import { json, readJsonBody } from '@/lib/http/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

const WRONG = 'Email or password is incorrect.';

export const POST: APIRoute = async ({ request, cookies }) => {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
  if (!EMAIL_RE.test(email)) return json({ error: 'Enter your email address' }, 400);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) return json({ error: 'Enter your password' }, 400);

  if (!(await getAccess(email))) return json({ error: WRONG }, 400);

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return json({ error: 'Sign-in is not configured' }, 503);

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (error?.status === 429) {
      return json({ error: 'Too many attempts. Wait a minute and try again.' }, 429);
    }
    return json({ error: WRONG }, 400);
  }

  if (!(await finishSignIn(supabase, data.user, cookies))) return json({ error: WRONG }, 400);
  return json({ redirectTo: safeReturnUrl(body.returnUrl) });
};
