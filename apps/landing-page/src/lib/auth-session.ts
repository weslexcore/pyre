// Server-side session validation and token refresh
// Used by API routes and SSR pages to validate auth state

import type { AstroCookies } from 'astro';
import { getAuthTokens, setAuthTokens } from './auth-cookies';
import { fetchUserProfile, isTokenExpired, refreshAccessToken } from './momence-oauth';
import type { AuthSession, MomenceTokenData, MomenceUserProfile } from './momence-oauth-types';

/**
 * Result of session validation with optional refreshed tokens
 */
interface SessionValidationResult {
  session: AuthSession;
  tokens: MomenceTokenData | null;
  refreshed: boolean;
}

/**
 * Validate the current session and refresh tokens if needed
 * Returns the session state and optionally refreshed tokens
 */
export async function validateSession(cookies: AstroCookies): Promise<SessionValidationResult> {
  const tokens = getAuthTokens(cookies);

  // No tokens = not authenticated
  if (!tokens) {
    console.log('[Auth] No tokens found in cookies');
    return {
      session: { isAuthenticated: false, user: null, expiresAt: null },
      tokens: null,
      refreshed: false,
    };
  }

  console.log('[Auth] Found tokens, checking expiry...');
  let currentTokens = tokens;
  let refreshed = false;

  // Check if access token is expired or about to expire
  if (isTokenExpired(tokens.expiresAt)) {
    console.log('[Auth] Token expired, attempting refresh...');
    try {
      currentTokens = await refreshAccessToken(tokens.refreshToken);
      setAuthTokens(cookies, currentTokens);
      refreshed = true;
      console.info('[Auth] Access token refreshed successfully');
    } catch (error) {
      console.error('[Auth] Token refresh failed:', error);
      // Token refresh failed - user needs to re-authenticate
      return {
        session: { isAuthenticated: false, user: null, expiresAt: null },
        tokens: null,
        refreshed: false,
      };
    }
  }

  console.log('[Auth] Token is valid, fetching profile...');

  // Try to fetch user profile, but don't fail auth if profile fetch fails
  let user: MomenceUserProfile | null = null;
  try {
    user = await fetchUserProfile(currentTokens.accessToken);
    console.log('[Auth] Profile fetched successfully:', user);
  } catch (error) {
    console.warn('[Auth] Profile fetch failed, using minimal user data:', error);
    // Profile fetch failed but token is valid - use minimal user data
    // The user is still authenticated, we just don't have their profile details
    user = {
      id: currentTokens.userId || 0,
      email: '',
      firstName: 'Member',
      lastName: '',
    };
    console.log('[Auth] Using minimal user with ID:', user.id);
  }

  return {
    session: {
      isAuthenticated: true,
      user,
      expiresAt: currentTokens.expiresAt,
    },
    tokens: currentTokens,
    refreshed,
  };
}

/**
 * Get valid access token, refreshing if needed
 * Returns null if user is not authenticated
 */
export async function getValidAccessToken(cookies: AstroCookies): Promise<string | null> {
  const tokens = getAuthTokens(cookies);

  if (!tokens) {
    return null;
  }

  // Check if access token is expired or about to expire
  if (isTokenExpired(tokens.expiresAt)) {
    try {
      const newTokens = await refreshAccessToken(tokens.refreshToken);
      setAuthTokens(cookies, newTokens);
      return newTokens.accessToken;
    } catch (error) {
      console.error('[Auth] Token refresh failed:', error);
      return null;
    }
  }

  return tokens.accessToken;
}

/**
 * Quick check if user appears to be authenticated
 * Does NOT validate the token - use validateSession for that
 */
export function isAuthenticated(cookies: AstroCookies): boolean {
  const tokens = getAuthTokens(cookies);
  return tokens !== null;
}

/**
 * Get cached user profile without validation
 * Useful for quick checks where token validation isn't critical
 */
export async function getSessionUser(cookies: AstroCookies): Promise<MomenceUserProfile | null> {
  const tokens = getAuthTokens(cookies);

  if (!tokens) {
    return null;
  }

  // Don't refresh here - just try with current token
  // If it fails, return null and let the next request handle it
  try {
    return await fetchUserProfile(tokens.accessToken);
  } catch {
    return null;
  }
}
