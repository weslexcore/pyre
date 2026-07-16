// Momence OAuth V2 helpers — port of apps/landing-page/src/lib/momence-oauth.ts
// (same client credentials env vars; the redirect URI is derived from this
// app's origin, so the integrations deployment's /api/auth/callback must be
// registered as an allowed redirect URI on the Momence OAuth client).

import type { MomenceTokenData, MomenceTokenResponse, MomenceUserProfile } from './types';

const MOMENCE_OAUTH_BASE = 'https://api.momence.com/api/v2/auth';

function getOAuthConfig(requestUrl?: URL) {
  const clientId = import.meta.env.MOMENCE_OAUTH_CLIENT_ID;
  const clientSecret = import.meta.env.MOMENCE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing Momence OAuth configuration. Check environment variables.');
  }

  const redirectUri = requestUrl ? `${requestUrl.origin}/api/auth/callback` : '';

  return { clientId, clientSecret, redirectUri };
}

/** Generate a cryptographically secure random state string. */
export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildAuthorizationUrl(requestUrl: URL, state: string): string {
  const { clientId, redirectUri } = getOAuthConfig(requestUrl);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'public-api-v2',
    state,
    prompt: 'login',
  });

  return `${MOMENCE_OAUTH_BASE}/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  requestUrl: URL,
  code: string
): Promise<MomenceTokenData> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig(requestUrl);

  const response = await fetch(`${MOMENCE_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] Token exchange failed:', response.status, errorText.substring(0, 200));
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const data = await response.json();

  // Momence has answered with both camelCase and snake_case over time.
  const accessToken = data.access_token || data.accessToken;
  const refreshToken = data.refresh_token || data.refreshToken;
  const expiresIn = data.expires_in || data.expiresIn || 3600;
  const userId = data.user?.id || data.userId || data.user_id;

  if (!accessToken) {
    throw new Error('No access token in Momence token response');
  }

  return {
    accessToken,
    refreshToken: refreshToken || '',
    expiresAt: Date.now() + expiresIn * 1000,
    scope: data.scope || '',
    userId,
  };
}

export async function refreshAccessToken(currentRefreshToken: string): Promise<MomenceTokenData> {
  const { clientId, clientSecret } = getOAuthConfig();

  const response = await fetch(`${MOMENCE_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: currentRefreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] Token refresh failed:', response.status, errorText.substring(0, 200));
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data: MomenceTokenResponse = await response.json();

  // biome-ignore lint/suspicious/noExplicitAny: Momence mixes snake_case and camelCase
  const raw = data as any;
  const accessToken = data.access_token || raw.accessToken;
  const newRefreshToken = data.refresh_token || raw.refreshToken || currentRefreshToken;
  const expiresIn = data.expires_in || raw.expiresIn || 3600;

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: data.scope || '',
  };
}

/**
 * Fetch the authenticated user's profile via GET /api/v2/auth/profile — the
 * one documented endpoint for the authorization-code (customer) flow. Returns
 * a flat AuthProfileDto with required userId/email/firstName/lastName.
 */
export async function fetchUserProfile(accessToken: string): Promise<MomenceUserProfile> {
  const response = await fetch(`${MOMENCE_OAUTH_BASE}/profile`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] Profile fetch failed:', response.status, errorText.substring(0, 200));
    throw new Error(`Profile fetch failed: ${response.status}`);
  }

  const data = await response.json();

  return {
    id: data.userId,
    email: data.email || '',
    firstName: data.firstName || 'User',
    lastName: data.lastName || '',
  };
}

/** Expired or about to expire (within 5 minutes by default). */
export function isTokenExpired(expiresAt: number, bufferMs: number = 5 * 60 * 1000): boolean {
  return Date.now() >= expiresAt - bufferMs;
}
