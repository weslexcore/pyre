// The ways a person can sign in besides the emailed link: a password and any
// number of passkeys, both added on /admin/account once they are signed in.
// They are there so that losing the inbox does not mean losing the dashboard.
//
// Passkeys are bound to the WebAuthn relying party ID set in
// apps/supabase/config.toml: integrations.pyresauna.com in production (which
// covers staging), localhost locally. A Vercel preview URL cannot match it,
// so passkeys are only offered on PASSKEY_HOSTS.
//
// Supabase does not say whether a user has a password, so setting one also
// sets app_metadata.has_password (service role only, so a user cannot set it
// for themselves).

import type { PasskeyListItem, SupabaseClient } from '@supabase/supabase-js';

const PASSKEY_HOSTS = new Set([
  'integrations.pyresauna.com',
  'staging.integrations.pyresauna.com',
  'localhost',
]);

/** Whether a passkey can be made or used on the page at `url`. */
export function passkeysAvailable(url: URL): boolean {
  return PASSKEY_HOSTS.has(url.hostname);
}

export interface SignInMethods {
  hasPassword: boolean;
  passkeys: PasskeyListItem[];
}

/** What a user has set up beyond email. Read with the service-role client. */
export async function getSignInMethods(db: SupabaseClient, userId: string): Promise<SignInMethods> {
  const [userResult, passkeyResult] = await Promise.all([
    db.auth.admin.getUserById(userId),
    db.auth.admin.passkey.listPasskeys({ userId }).catch((error: unknown) => ({
      data: null,
      error: error instanceof Error ? error : new Error(String(error)),
    })),
  ]);
  if (userResult.error) console.warn('[Auth] getUserById failed:', userResult.error.message);
  if (passkeyResult.error) console.warn('[Auth] listPasskeys failed:', passkeyResult.error.message);
  return {
    hasPassword: userResult.data?.user?.app_metadata?.has_password === true,
    passkeys: passkeyResult.data ?? [],
  };
}

/** Record that the user now has a password (see the header). */
export async function markHasPassword(db: SupabaseClient, userId: string): Promise<void> {
  const { error } = await db.auth.admin.updateUserById(userId, {
    app_metadata: { has_password: true },
  });
  if (error) console.warn('[Auth] Could not record has_password:', error.message);
}

const PASSKEY_ERROR_COPY: Record<string, string> = {
  passkey_disabled: 'Passkey sign-in is not turned on yet.',
  webauthn_credential_not_found:
    'That passkey is not registered here. Sign in another way, then add it again.',
  webauthn_challenge_expired: 'That took too long. Try again.',
  webauthn_challenge_not_found: 'That took too long. Try again.',
  webauthn_credential_exists: 'This device already has a passkey here.',
  too_many_passkeys: 'You have the most passkeys allowed. Remove one first.',
  webauthn_verification_failed: 'That passkey could not be verified. Try again.',
};

/** Copy the form can show for a failed passkey call. */
export function passkeyErrorMessage(error: { code?: string; message?: string } | null): string {
  return (error?.code && PASSKEY_ERROR_COPY[error.code]) || 'Passkey sign-in failed. Try again.';
}
