// Authentication cookie management
// Secure HTTP-only cookies for OAuth tokens

import type { AstroCookies } from 'astro';
import type { MomenceTokenData, OAuthState } from './momence-oauth-types';

// Cookie names
const ACCESS_TOKEN_COOKIE = 'pyre_access_token';
const REFRESH_TOKEN_COOKIE = 'pyre_refresh_token';
const TOKEN_EXPIRES_COOKIE = 'pyre_token_expires';
const USER_ID_COOKIE = 'pyre_user_id';
const OAUTH_STATE_COOKIE = 'pyre_oauth_state';

// Cookie configuration
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: import.meta.env.PROD,
  sameSite: 'lax' as const,
  path: '/',
};

// Token cookie max age (30 days)
const TOKEN_MAX_AGE = 60 * 60 * 24 * 30;

// State cookie max age (10 minutes - just for OAuth flow)
const STATE_MAX_AGE = 60 * 10;

/**
 * Set OAuth tokens in secure cookies
 */
export function setAuthTokens(cookies: AstroCookies, tokens: MomenceTokenData): void {
  console.log('[Cookies] Setting auth tokens...');
  console.log('[Cookies] Cookie options:', COOKIE_OPTIONS);

  cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: TOKEN_MAX_AGE,
  });
  console.log('[Cookies] Set access token cookie');

  cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: TOKEN_MAX_AGE,
  });
  console.log('[Cookies] Set refresh token cookie');

  cookies.set(TOKEN_EXPIRES_COOKIE, String(tokens.expiresAt), {
    ...COOKIE_OPTIONS,
    maxAge: TOKEN_MAX_AGE,
  });
  console.log('[Cookies] Set expires cookie');

  if (tokens.userId) {
    cookies.set(USER_ID_COOKIE, String(tokens.userId), {
      ...COOKIE_OPTIONS,
      maxAge: TOKEN_MAX_AGE,
    });
    console.log('[Cookies] Set user ID cookie:', tokens.userId);
  }

  console.log('[Cookies] All cookies set successfully');
}

/**
 * Get OAuth tokens from cookies
 */
export function getAuthTokens(cookies: AstroCookies): MomenceTokenData | null {
  console.log('[Cookies] Getting auth tokens from cookies...');

  const accessToken = cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const expiresAtStr = cookies.get(TOKEN_EXPIRES_COOKIE)?.value;
  const userIdStr = cookies.get(USER_ID_COOKIE)?.value;

  console.log('[Cookies] accessToken present:', !!accessToken);
  console.log('[Cookies] refreshToken present:', !!refreshToken);
  console.log('[Cookies] expiresAtStr:', expiresAtStr);
  console.log('[Cookies] userIdStr:', userIdStr);

  if (!accessToken || !refreshToken || !expiresAtStr) {
    console.log('[Cookies] Missing required cookies, returning null');
    return null;
  }

  const expiresAt = Number.parseInt(expiresAtStr, 10);
  if (Number.isNaN(expiresAt)) {
    console.log('[Cookies] Invalid expiresAt, returning null');
    return null;
  }

  const userId = userIdStr ? Number.parseInt(userIdStr, 10) : undefined;

  console.log('[Cookies] Successfully retrieved tokens, userId:', userId);

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scope: '', // Scope not stored in cookie, not needed for API calls
    userId: Number.isNaN(userId) ? undefined : userId,
  };
}

/**
 * Clear all auth cookies (logout)
 */
export function clearAuthCookies(cookies: AstroCookies): void {
  const deleteOptions = {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  };

  cookies.delete(ACCESS_TOKEN_COOKIE, deleteOptions);
  cookies.delete(REFRESH_TOKEN_COOKIE, deleteOptions);
  cookies.delete(TOKEN_EXPIRES_COOKIE, deleteOptions);
  cookies.delete(USER_ID_COOKIE, deleteOptions);
  cookies.delete(OAUTH_STATE_COOKIE, deleteOptions);
}

/**
 * Set OAuth state cookie for CSRF protection
 */
export function setOAuthState(cookies: AstroCookies, state: OAuthState): void {
  cookies.set(OAUTH_STATE_COOKIE, JSON.stringify(state), {
    ...COOKIE_OPTIONS,
    maxAge: STATE_MAX_AGE,
  });
}

/**
 * Get and clear OAuth state cookie
 */
export function getAndClearOAuthState(cookies: AstroCookies): OAuthState | null {
  const stateStr = cookies.get(OAUTH_STATE_COOKIE)?.value;

  // Clear the state cookie immediately after reading (delete expires the
  // cookie itself; Astro 7's AstroCookieDeleteOptions no longer takes maxAge)
  cookies.delete(OAUTH_STATE_COOKIE, {
    ...COOKIE_OPTIONS,
  });

  if (!stateStr) {
    return null;
  }

  try {
    return JSON.parse(stateStr) as OAuthState;
  } catch {
    return null;
  }
}

/**
 * Check if user has auth cookies (quick check, doesn't validate tokens)
 */
export function hasAuthCookies(cookies: AstroCookies): boolean {
  return !!cookies.get(ACCESS_TOKEN_COOKIE)?.value;
}
