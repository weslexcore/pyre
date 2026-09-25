// Server-side session validation for the /admin pages and admin API routes.
//
// Supabase Auth is the session. During the cutover, a Momence OAuth session is
// still recognised — but only as proof of identity for setting a Supabase
// password (source 'momence'); middleware and requireAccess refuse it for
// anything else. AUTH_MOMENCE_LOGIN=off ends the cutover and drops the
// fallback entirely.

import type { AstroCookies } from 'astro';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getAuthTokens, setAuthTokens } from './cookies';
import { fetchUserProfile, isTokenExpired, refreshAccessToken } from './momence-oauth';
import { getCachedProfile, profileTtlMs, setCachedProfile } from './profile-cache';
import type { AuthSession, MomenceTokenData, MomenceUserProfile } from './types';

const UNAUTHENTICATED: AuthSession = {
  isAuthenticated: false,
  user: null,
  expiresAt: null,
  source: null,
};

/** Whether "Continue with Momence" is still offered (the cutover window). */
export function momenceLoginEnabled(): boolean {
  return (import.meta.env.AUTH_MOMENCE_LOGIN ?? '').trim().toLowerCase() !== 'off';
}

export async function validateSession(cookies: AstroCookies): Promise<{ session: AuthSession }> {
  const supabase = await validateSupabaseSession(cookies);
  if (supabase) return { session: supabase };

  if (!momenceLoginEnabled()) return { session: UNAUTHENTICATED };
  return { session: await validateMomenceSession(cookies) };
}

/**
 * getClaims() verifies the access token locally against the project's JWKS
 * (asymmetric signing keys), so checklist taps don't pay a network round trip;
 * an expired token is refreshed first and the new cookies written back.
 */
async function validateSupabaseSession(cookies: AstroCookies): Promise<AuthSession | null> {
  const supabase = createSupabaseServerClient(cookies);
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;
    const { claims } = data;
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!claims.sub || !email) return null;

    const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
    return {
      isAuthenticated: true,
      user: {
        id: claims.sub,
        email,
        firstName: typeof meta.first_name === 'string' ? meta.first_name : '',
        lastName: typeof meta.last_name === 'string' ? meta.last_name : '',
      },
      expiresAt: typeof claims.exp === 'number' ? claims.exp * 1000 : null,
      source: 'supabase',
    };
  } catch (error) {
    console.warn('[Auth] Supabase session check failed:', error);
    return null;
  }
}

/**
 * The pre-cutover Momence OAuth session. The admin gate is an email
 * allowlist, so a failed profile fetch is unauthenticated rather than a
 * profile without an email. The profile behind a token is cached briefly
 * (see ./profile-cache) to keep the Momence round trip off every request.
 */
async function validateMomenceSession(cookies: AstroCookies): Promise<AuthSession> {
  const tokens = getAuthTokens(cookies);
  if (!tokens) return UNAUTHENTICATED;

  let currentTokens: MomenceTokenData = tokens;

  if (isTokenExpired(tokens.expiresAt)) {
    try {
      currentTokens = await refreshAccessToken(tokens.refreshToken);
      setAuthTokens(cookies, currentTokens);
    } catch (error) {
      console.error('[Auth] Token refresh failed:', error);
      return UNAUTHENTICATED;
    }
  }

  let user: MomenceUserProfile | null = await getCachedProfile(currentTokens.accessToken);
  if (!user) {
    try {
      user = await fetchUserProfile(currentTokens.accessToken);
    } catch (error) {
      console.warn('[Auth] Profile fetch failed:', error);
      return UNAUTHENTICATED;
    }
    const now = Date.now();
    // Fire-and-forget: the in-memory write is synchronous inside, and the
    // request shouldn't wait on Redis.
    void setCachedProfile(
      currentTokens.accessToken,
      user,
      profileTtlMs(now, currentTokens.expiresAt),
      now
    );
  }

  return {
    isAuthenticated: true,
    user: {
      id: String(user.id),
      email: (user.email ?? '').trim().toLowerCase(),
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
    },
    expiresAt: currentTokens.expiresAt,
    source: 'momence',
  };
}
