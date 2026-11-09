// Server-side session validation. Every /admin page (via the middleware) and
// every cookie-authenticated API route starts here.
//
// The session is a Supabase Auth session in httpOnly cookies
// (lib/supabase/server). getClaims() verifies the access token's signature
// locally against the project's public signing keys (cached per instance), so
// a warm request costs no network round trip — and when the token is about
// to expire it refreshes first, writing the new cookies onto this response.
// Dashboard access itself is decided by the staff table (lib/auth/access),
// keyed on the email in the token.

import type { AstroCookies } from 'astro';
import { normalizeEmail } from '@/lib/email/address';
import { createSupabaseServerClient, hasSessionCookie } from '@/lib/supabase/server';
import type { SessionUser, ValidatedSession } from './types';

const UNAUTHENTICATED: ValidatedSession = {
  session: { isAuthenticated: false, user: null, expiresAt: null },
  accessToken: null,
};

// Cookies the Momence OAuth login used to set. Deleted on sight so a browser
// that signed in before the switch comes back clean.
const LEGACY_COOKIES = [
  'pyre_access_token',
  'pyre_refresh_token',
  'pyre_token_expires',
  'pyre_user_id',
  'pyre_oauth_state',
];

export function purgeLegacyCookies(cookies: AstroCookies): void {
  if (!LEGACY_COOKIES.some((name) => cookies.has(name))) return;
  for (const name of LEGACY_COOKIES) cookies.delete(name, { path: '/' });
}

export interface SessionClaims {
  sub: string;
  email?: string;
  exp: number;
  user_metadata?: Record<string, unknown>;
}

/** The user a verified token describes; null when it names no email. */
export function sessionUserFromClaims(claims: SessionClaims): SessionUser | null {
  const email = normalizeEmail(claims.email);
  if (!claims.sub || !email) return null;
  const meta = claims.user_metadata ?? {};
  const named = typeof meta.display_name === 'string' ? meta.display_name.trim() : '';
  const displayName = named || email.split('@')[0];
  const [firstName = '', ...rest] = displayName.split(/\s+/);
  return { id: claims.sub, email, displayName, firstName, lastName: rest.join(' ') };
}

export async function validateSession(cookies: AstroCookies): Promise<ValidatedSession> {
  purgeLegacyCookies(cookies);
  if (!hasSessionCookie(cookies)) return UNAUTHENTICATED;

  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return UNAUTHENTICATED;

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) {
    // An expired refresh token, a revoked session, a tampered cookie: all
    // land here, and all mean "sign in again".
    if (error) console.warn('[Auth] Session rejected:', error.message);
    return UNAUTHENTICATED;
  }

  const user = sessionUserFromClaims(data.claims as SessionClaims);
  if (!user) return UNAUTHENTICATED;

  // getClaims() has just loaded (and if needed refreshed) the session, so
  // this is an in-memory read, not another round trip.
  const { data: sessionData } = await supabase.auth.getSession();

  return {
    session: { isAuthenticated: true, user, expiresAt: data.claims.exp * 1000 },
    accessToken: sessionData.session?.access_token ?? null,
  };
}
