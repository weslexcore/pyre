// Supabase Auth accounts for staff: creating them, linking them to their
// `staff` row, emailing set-password links, and keeping bans in step with
// dashboard access. Server-only — every call here uses the secret-key client
// (getDb) and its auth.admin API.
//
// Nobody can sign themselves up (public sign-ups are off): an account only
// exists because a staff row with dashboard access named that email, and the
// person proved they own it — through Momence during the cutover, or by
// opening an emailed link.

import { canUseDashboard } from '@/lib/sops/levels';
import { getDb, type StaffRow } from '../db';
import { sendTemplate } from '../email/send';
import { getAccess, invalidateAccessCache, listStaff } from './access';

export const MIN_PASSWORD_LENGTH = 10;
// bcrypt ignores everything past 72 bytes; refuse rather than silently truncate.
export const MAX_PASSWORD_LENGTH = 72;

export type PasswordProblem = 'too_short' | 'too_long' | 'mismatch';

/** What's wrong with a new password pair, or null when it's fine. */
export function passwordProblem(password: string, confirm: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too_short';
  // bcrypt counts bytes, not characters.
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_LENGTH) return 'too_long';
  if (password !== confirm) return 'mismatch';
  return null;
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** The staff row for an email (fresh read, not the 30s access cache). */
export async function findStaffByEmail(email: string): Promise<StaffRow | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const rows = await listStaff(true);
  return rows?.find((r) => r.email === normalized) ?? null;
}

/**
 * Whether this email signs in with a Supabase password. A staff row is linked
 * only once its person has set a password (set-password links it), so a
 * pending invite doesn't count.
 */
export async function hasLinkedAccount(email: string): Promise<boolean> {
  const row = await findStaffByEmail(email);
  if (row) return !!row.auth_user_id;
  // No row: an env-allowlisted bootstrap admin (nothing to link), or a
  // stranger. Only the first can have an auth user — accounts are never
  // created for emails without access.
  return !!(await authUserIdByEmail(email));
}

/** The auth.users id for an email, via a service-role-only SQL function. */
export async function authUserIdByEmail(email: string): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db.rpc('auth_user_id_by_email', { p_email: normalizeEmail(email) });
  if (error) {
    console.error('[provision] auth user lookup failed:', error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Record which auth user a staff row signs in as. */
export async function linkStaff(staffId: string, authUserId: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Storage unavailable');
  const { error } = await db.from('staff').update({ auth_user_id: authUserId }).eq('id', staffId);
  if (error) throw new Error(`Linking staff row failed: ${error.message}`);
  invalidateAccessCache();
}

function splitName(displayName: string): { first_name: string; last_name: string } {
  const [first = '', ...rest] = displayName.trim().split(/\s+/);
  return { first_name: first, last_name: rest.join(' ') };
}

export type ProvisionResult =
  | { status: 'created'; userId: string }
  | { status: 'already-linked' }
  | { status: 'no-access' }
  | { status: 'error'; message: string };

/**
 * The cutover step: a person who just proved their identity through Momence
 * sets their first password. Creates the auth user (or adopts one a pending
 * invite created), sets the password, and links the staff row. The caller
 * signs them in afterwards.
 */
export async function createAccountWithPassword(args: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}): Promise<ProvisionResult> {
  const db = getDb();
  if (!db) return { status: 'error', message: 'Storage unavailable' };

  const email = normalizeEmail(args.email);
  // Only people with dashboard access get an account — a Momence login alone
  // proves an identity, not a job here.
  if (!(await getAccess(email))) return { status: 'no-access' };

  const row = await findStaffByEmail(email);
  if (row?.auth_user_id) return { status: 'already-linked' };

  const metadata = { first_name: args.firstName, last_name: args.lastName };
  let userId = await authUserIdByEmail(email);

  if (userId) {
    // An unfinished invite (or an account from before a row was relinked).
    // Momence just vouched for the email, so confirm it and take the password.
    const { error } = await db.auth.admin.updateUserById(userId, {
      password: args.password,
      email_confirm: true,
      user_metadata: metadata,
      ban_duration: 'none',
    });
    if (error) return { status: 'error', message: error.message };
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: args.password,
      // The email matches a staff row an admin entered, and Momence has just
      // authenticated its owner — no confirmation mail needed.
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error || !data.user) {
      return { status: 'error', message: error?.message ?? 'Account creation failed' };
    }
    userId = data.user.id;
  }

  // Env-allowlisted bootstrap admins have no row to link; their access still
  // resolves by email.
  if (row) await linkStaff(row.id, userId);
  return { status: 'created', userId };
}

/**
 * Link a staff row to the account a set-password (email link) session just
 * gave a password to. Harmless when already linked.
 */
export async function linkAfterPasswordSet(email: string, authUserId: string): Promise<void> {
  const row = await findStaffByEmail(email);
  if (row && row.auth_user_id !== authUserId) await linkStaff(row.id, authUserId);
}

export type PasswordLinkResult = 'sent' | 'no-access' | 'not-sent';

/**
 * Email a one-time link that opens /set-password. `recovery` for someone who
 * already has an auth user, `invite` (which creates it) for someone who
 * doesn't — the post-cutover path for staff who never linked through Momence,
 * and what /admin/users' "send set-password link" uses.
 *
 * The link goes to our own /api/auth/confirm with the hashed token, rather
 * than through Supabase's redirect, so the session cookie is set server-side
 * and no redirect allow-list entry is needed per deployment.
 */
export async function sendPasswordLink(email: string, origin: string): Promise<PasswordLinkResult> {
  const db = getDb();
  if (!db) return 'not-sent';

  const normalized = normalizeEmail(email);
  if (!(await getAccess(normalized))) return 'no-access';

  const row = await findStaffByEmail(normalized);
  const existingId = row?.auth_user_id ?? (await authUserIdByEmail(normalized));
  const names = splitName(row?.display_name ?? '');

  // Someone removed and later re-added keeps a banned auth user; they have
  // access again (checked above), so lift the ban before the link is used.
  if (existingId) {
    const { error: unbanError } = await db.auth.admin.updateUserById(existingId, {
      ban_duration: 'none',
    });
    if (unbanError) console.error('[provision] unban failed:', unbanError.message);
  }

  const { data, error } = existingId
    ? await db.auth.admin.generateLink({ type: 'recovery', email: normalized })
    : await db.auth.admin.generateLink({
        type: 'invite',
        email: normalized,
        options: { data: names },
      });
  if (error || !data?.properties?.hashed_token) {
    console.error('[provision] generateLink failed:', error?.message);
    return 'not-sent';
  }

  const confirm = new URL('/api/auth/confirm', origin);
  confirm.searchParams.set('token_hash', data.properties.hashed_token);
  confirm.searchParams.set('type', data.properties.verification_type);

  try {
    const result = await sendTemplate({
      to: normalized,
      template: 'staff-password-link',
      props: {
        firstName: names.first_name || 'there',
        actionUrl: confirm.toString(),
        isInvite: !row?.auth_user_id,
      },
    });
    return result.status === 'sent' ? 'sent' : 'not-sent';
  } catch (e) {
    console.error('[provision] password link email failed:', e instanceof Error ? e.message : e);
    return 'not-sent';
  }
}

// ~100 years: Supabase's way of saying "banned until unbanned".
const BAN_FOREVER = '876000h';

/**
 * Keep a linked account's ban in step with the row: someone who loses all
 * dashboard access (deactivated, grants removed, row deleted) is banned, so
 * their refresh token stops working too; getting access back unbans them.
 * getAccess and is_admin() already deny them — this closes the remaining
 * window where a live JWT still passes RLS as `authenticated`.
 */
export async function syncAuthBan(
  row: Pick<StaffRow, 'auth_user_id' | 'is_admin' | 'active' | 'pages'>,
  { deleted = false }: { deleted?: boolean } = {}
): Promise<void> {
  const db = getDb();
  if (!db || !row.auth_user_id) return;
  const banned = deleted || !canUseDashboard(row);
  const { error } = await db.auth.admin.updateUserById(row.auth_user_id, {
    ban_duration: banned ? BAN_FOREVER : 'none',
  });
  if (error) console.error('[provision] ban sync failed:', error.message);
}

/**
 * The login email follows the staff row: an admin changing someone's email on
 * /admin/users changes the address they sign in with.
 */
export async function syncAuthEmail(
  authUserId: string | null,
  email: string | null
): Promise<void> {
  const db = getDb();
  if (!db || !authUserId || !email) return;
  const { error } = await db.auth.admin.updateUserById(authUserId, {
    email,
    email_confirm: true,
  });
  if (error) console.error('[provision] email sync failed:', error.message);
}
