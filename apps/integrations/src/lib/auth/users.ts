// The auth.users side of a person on /admin/users. Dashboard logins are
// Supabase Auth, invite-only: nobody signs up, so the auth user has to exist
// before the person can ask for a sign-in link. These helpers keep that row
// in step with the staff row — created when a person with dashboard access
// is added (or seeded), updated when their email or name changes, deleted
// with the person — and link the two through staff.user_id.
//
// Service-role only: the admin API behind getDb() creates users. Every helper
// returns a result rather than throwing, because none of this should stop
// the staff row from being written — a person whose auth user failed to
// create is still on the roster, and the sign-in callback links an existing
// auth user to their row on first login (linkStaffUser).

import type { SupabaseClient, User } from '@supabase/supabase-js';
import { normalizeEmail } from '@/lib/email/address';

export type AuthUserResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; error: string };

export interface AuthUserInput {
  email: string;
  displayName: string | null;
}

/** Supabase answers a duplicate email with this code (HTTP 422). */
function isEmailTaken(error: { code?: string; message: string }): boolean {
  return error.code === 'email_exists' || /already (been )?registered/i.test(error.message);
}

/**
 * The auth user with `email`, if one exists. The admin API has no lookup by
 * email, so this pages through the list — a dozen staff, one page.
 */
export async function findAuthUserByEmail(db: SupabaseClient, email: string): Promise<User | null> {
  const wanted = normalizeEmail(email);
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.warn('[auth/users] listUsers failed:', error.message);
      return null;
    }
    const hit = data.users.find((u) => normalizeEmail(u.email) === wanted);
    if (hit) return hit;
    if (data.users.length < perPage) return null;
  }
  return null;
}

/**
 * Make sure an auth user exists for `email`, confirmed (no verification mail
 * — the magic link is the only email they ever get) and carrying the display
 * name the dashboard shows. Returns the existing user when there is one.
 */
export async function ensureAuthUser(
  db: SupabaseClient,
  input: AuthUserInput
): Promise<AuthUserResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: 'No email' };

  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: input.displayName ? { display_name: input.displayName } : undefined,
  });
  if (!error && data.user) return { ok: true, userId: data.user.id, created: true };

  if (error && isEmailTaken(error)) {
    const existing = await findAuthUserByEmail(db, email);
    if (existing) {
      if (input.displayName && existing.user_metadata?.display_name !== input.displayName) {
        await syncAuthUser(db, existing.id, { displayName: input.displayName });
      }
      return { ok: true, userId: existing.id, created: false };
    }
  }

  const message = error?.message ?? 'No user returned';
  console.warn('[auth/users] createUser failed:', message);
  return { ok: false, error: message };
}

/**
 * Change an auth user's email and/or display name. The email is written as
 * confirmed — an admin changed it on People, nobody needs to verify it.
 */
export async function syncAuthUser(
  db: SupabaseClient,
  userId: string,
  changes: { email?: string; displayName?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const attributes: { email?: string; email_confirm?: boolean; user_metadata?: object } = {};
  if (changes.email !== undefined) {
    attributes.email = normalizeEmail(changes.email);
    attributes.email_confirm = true;
  }
  if (changes.displayName !== undefined) {
    attributes.user_metadata = { display_name: changes.displayName ?? null };
  }
  if (Object.keys(attributes).length === 0) return { ok: true };

  const { error } = await db.auth.admin.updateUserById(userId, attributes);
  if (error) {
    console.warn('[auth/users] updateUserById failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Delete an auth user; staff.user_id goes null through the FK. */
export async function removeAuthUser(
  db: SupabaseClient,
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) {
    console.warn('[auth/users] deleteUser failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * First-sign-in link: point the staff row with this email at the auth user
 * that just signed in, when the row is not linked yet. The RLS helpers fall
 * back to the JWT email for unlinked rows, so this is a convenience the
 * callback performs, not a precondition of access. A row already linked to a
 * different user is left alone (People manages that explicitly).
 */
export async function linkStaffUser(
  db: SupabaseClient,
  userId: string,
  email: string
): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const { error } = await db
    .from('staff')
    .update({ user_id: userId })
    .eq('email', normalized)
    .is('user_id', null);
  if (error) console.warn('[auth/users] linkStaffUser failed:', error.message);
}
