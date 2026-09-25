// Sets a staff member's Supabase password. Two ways in:
//
// - Cutover (Momence session): they just signed in through Momence, which
//   proves they own the email. Create (or adopt) the auth user, link the staff
//   row, sign them in with the new password, and drop the Momence cookies.
// - Emailed link (Supabase session from /api/auth/confirm): an invite or a
//   reset. Update the password on the session they already hold and link the
//   row if this was their first.

import type { APIRoute } from 'astro';
import { assertSameOrigin } from '@/lib/auth/admin';
import { clearAuthCookies } from '@/lib/auth/cookies';
import {
  createAccountWithPassword,
  linkAfterPasswordSet,
  passwordProblem,
} from '@/lib/auth/provision';
import { safeReturnUrl, withReturnUrl } from '@/lib/auth/return-url';
import { validateSession } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const form = await request.formData();
  const returnUrl = safeReturnUrl(String(form.get('returnUrl') ?? ''));
  const mode = form.get('mode') === 'reset' ? 'reset' : 'cutover';
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');
  const back = (error: string) =>
    redirect(withReturnUrl('/set-password', returnUrl, { mode, error }), 303);

  const problem = passwordProblem(password, confirm);
  if (problem) return back(problem);

  const { session } = await validateSession(cookies);
  if (!session.isAuthenticated || !session.user) {
    return redirect(withReturnUrl('/', returnUrl), 303);
  }

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return back('unavailable');

  if (session.source === 'supabase') {
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error || !data.user) {
      console.error('[Auth] Password update failed:', error?.message);
      return back(error?.code === 'same_password' ? 'same_password' : 'save_failed');
    }
    await linkAfterPasswordSet(session.user.email, data.user.id);
    clearAuthCookies(cookies);
    return redirect(returnUrl, 303);
  }

  // Cutover: a Momence session.
  const result = await createAccountWithPassword({
    email: session.user.email,
    password,
    firstName: session.user.firstName,
    lastName: session.user.lastName,
  });

  if (result.status === 'no-access') {
    clearAuthCookies(cookies);
    return redirect(withReturnUrl('/', returnUrl, { error: 'no_access' }), 303);
  }
  if (result.status === 'already-linked') {
    clearAuthCookies(cookies);
    return redirect(
      withReturnUrl('/', returnUrl, {
        step: 'password',
        email: session.user.email,
        notice: 'already_linked',
      }),
      303
    );
  }
  if (result.status === 'error') {
    console.error('[Auth] Account creation failed:', result.message);
    return back('create_failed');
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: session.user.email,
    password,
  });
  clearAuthCookies(cookies);
  if (error) {
    console.error('[Auth] Sign-in after account creation failed:', error.message);
    return redirect(
      withReturnUrl('/', returnUrl, { step: 'password', email: session.user.email }),
      303
    );
  }
  return redirect(returnUrl, 303);
};
