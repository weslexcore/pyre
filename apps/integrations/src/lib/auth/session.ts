// Server-side session validation with token refresh — port of
// apps/landing-page/src/lib/auth-session.ts. Used by the /admin page and the
// admin API routes.

import type { AstroCookies } from 'astro';
import { getAuthTokens, setAuthTokens } from './cookies';
import { fetchUserProfile, isTokenExpired, refreshAccessToken } from './momence-oauth';
import { getCachedProfile, profileTtlMs, setCachedProfile } from './profile-cache';
import type { AuthSession, MomenceTokenData, MomenceUserProfile } from './types';

const UNAUTHENTICATED: AuthSession = { isAuthenticated: false, user: null, expiresAt: null };

export async function validateSession(cookies: AstroCookies): Promise<{ session: AuthSession }> {
  const tokens = getAuthTokens(cookies);
  if (!tokens) return { session: UNAUTHENTICATED };

  let currentTokens: MomenceTokenData = tokens;

  if (isTokenExpired(tokens.expiresAt)) {
    try {
      currentTokens = await refreshAccessToken(tokens.refreshToken);
      setAuthTokens(cookies, currentTokens);
    } catch (error) {
      console.error('[Auth] Token refresh failed:', error);
      return { session: UNAUTHENTICATED };
    }
  }

  // The admin gate is an email allowlist, so unlike the landing page we treat
  // a failed profile fetch as unauthenticated rather than degrading to a
  // profile without an email (which could only ever render "Unauthorized").
  //
  // The profile behind a token is cached briefly (see ./profile-cache): the
  // Momence round trip otherwise sits on the critical path of every admin
  // page and every API call, checklist taps included.
  let user: MomenceUserProfile | null = await getCachedProfile(currentTokens.accessToken);
  if (!user) {
    try {
      user = await fetchUserProfile(currentTokens.accessToken);
    } catch (error) {
      console.warn('[Auth] Profile fetch failed:', error);
      return { session: UNAUTHENTICATED };
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
    session: {
      isAuthenticated: true,
      user,
      expiresAt: currentTokens.expiresAt,
    },
  };
}
