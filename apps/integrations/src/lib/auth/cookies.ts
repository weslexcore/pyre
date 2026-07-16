// Auth cookie management — port of apps/landing-page/src/lib/auth-cookies.ts.
// Same cookie names as the landing page; the apps live on different domains so
// the two sessions are independent.

import type { AstroCookies } from 'astro';
import type { MomenceTokenData, OAuthState } from './types';

const ACCESS_TOKEN_COOKIE = 'pyre_access_token';
const REFRESH_TOKEN_COOKIE = 'pyre_refresh_token';
const TOKEN_EXPIRES_COOKIE = 'pyre_token_expires';
const USER_ID_COOKIE = 'pyre_user_id';
const OAUTH_STATE_COOKIE = 'pyre_oauth_state';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: import.meta.env.PROD,
  sameSite: 'lax' as const,
  path: '/',
};

// Token cookie max age (30 days)
const TOKEN_MAX_AGE = 60 * 60 * 24 * 30;

// State cookie max age (10 minutes — just for the OAuth round-trip)
const STATE_MAX_AGE = 60 * 10;

export function setAuthTokens(cookies: AstroCookies, tokens: MomenceTokenData): void {
  cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: TOKEN_MAX_AGE,
  });
  cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: TOKEN_MAX_AGE,
  });
  cookies.set(TOKEN_EXPIRES_COOKIE, String(tokens.expiresAt), {
    ...COOKIE_OPTIONS,
    maxAge: TOKEN_MAX_AGE,
  });
  if (tokens.userId) {
    cookies.set(USER_ID_COOKIE, String(tokens.userId), {
      ...COOKIE_OPTIONS,
      maxAge: TOKEN_MAX_AGE,
    });
  }
}

export function getAuthTokens(cookies: AstroCookies): MomenceTokenData | null {
  const accessToken = cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const expiresAtStr = cookies.get(TOKEN_EXPIRES_COOKIE)?.value;
  const userIdStr = cookies.get(USER_ID_COOKIE)?.value;

  if (!accessToken || !refreshToken || !expiresAtStr) return null;

  const expiresAt = Number.parseInt(expiresAtStr, 10);
  if (Number.isNaN(expiresAt)) return null;

  const userId = userIdStr ? Number.parseInt(userIdStr, 10) : undefined;

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scope: '', // not stored in a cookie; not needed for API calls
    userId: Number.isNaN(userId) ? undefined : userId,
  };
}

const DELETE_OPTIONS = { path: COOKIE_OPTIONS.path };

export function clearAuthCookies(cookies: AstroCookies): void {
  cookies.delete(ACCESS_TOKEN_COOKIE, DELETE_OPTIONS);
  cookies.delete(REFRESH_TOKEN_COOKIE, DELETE_OPTIONS);
  cookies.delete(TOKEN_EXPIRES_COOKIE, DELETE_OPTIONS);
  cookies.delete(USER_ID_COOKIE, DELETE_OPTIONS);
  cookies.delete(OAUTH_STATE_COOKIE, DELETE_OPTIONS);
}

export function setOAuthState(cookies: AstroCookies, state: OAuthState): void {
  cookies.set(OAUTH_STATE_COOKIE, JSON.stringify(state), {
    ...COOKIE_OPTIONS,
    maxAge: STATE_MAX_AGE,
  });
}

/** Read the CSRF state cookie and clear it immediately (single use). */
export function getAndClearOAuthState(cookies: AstroCookies): OAuthState | null {
  const stateStr = cookies.get(OAUTH_STATE_COOKIE)?.value;
  cookies.delete(OAUTH_STATE_COOKIE, DELETE_OPTIONS);

  if (!stateStr) return null;

  try {
    return JSON.parse(stateStr) as OAuthState;
  } catch {
    return null;
  }
}
