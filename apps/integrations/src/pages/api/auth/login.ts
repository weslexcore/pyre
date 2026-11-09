// Step one of sign-in: the login form POSTs an email, and Supabase mails that
// address a magic link (back to /api/auth/callback) plus a 6-digit code.
//
// The staff table is the allowlist (People, /admin/users). An address that
// is not on it — or is on a row with no dashboard access — gets the same
// 200 as everyone else and no mail, and Supabase is never asked, so the form
// cannot be used to find out who is on staff. An address that is on it gets
// its auth user created right here the first time (sign-up itself stays
// closed: shouldCreateUser is false and the project can keep sign-ups
// disabled), then the link. Where to land afterwards is remembered in a
// short-lived cookie the callback and the code route read back.

import type { APIRoute } from 'astro';
import { getAccess, invalidateAccessCache, listStaff } from '@/lib/auth/access';
import { assertSameOrigin } from '@/lib/auth/admin';
import { EMAIL_RE, rememberReturnUrl, safeReturnUrl } from '@/lib/auth/login';
import { ensureAuthUser, linkStaffUser } from '@/lib/auth/users';
import { getDb } from '@/lib/db';
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

  // Not a team member: same answer as for one, and nothing goes out.
  const access = await getAccess(email);
  if (!access) return json({ ok: true });

  const supabase = createSupabaseServerClient(cookies);
  const db = getDb();
  if (!supabase || !db) return json({ error: 'Sign-in is not configured' }, 503);

  // First sign-in: the row has no auth user yet (or this is an
  // env-allowlisted admin with no row at all). Create it, confirmed, and
  // point the row at it so later requests skip this.
  const row = (await listStaff())?.find((r) => r.email === email) ?? null;
  if (!row?.user_id) {
    const ensured = await ensureAuthUser(db, { email, displayName: row?.display_name ?? null });
    if (!ensured.ok) {
      console.error('[Auth] Could not create the auth user:', ensured.error);
      return json({ error: 'Could not set up your sign-in. Try again in a moment.' }, 502);
    }
    if (row) {
      await linkStaffUser(db, ensured.userId, email);
      invalidateAccessCache();
    }
  }

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
    console.error('[Auth] signInWithOtp failed:', error.message);
    return json({ error: 'Could not send a sign-in link. Try again in a moment.' }, 502);
  }

  return json({ ok: true });
};
