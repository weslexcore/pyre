// QuickBooks OAuth 2.0 authorization-code helpers, shaped like
// lib/auth/momence-oauth.ts. Differences from Momence worth knowing:
//  - the token endpoint authenticates with HTTP Basic (client_id:client_secret),
//    not body params;
//  - refresh tokens ROTATE — every refresh response may carry a new
//    refresh_token that must replace the stored one, and the old one dies;
//  - the consent redirect carries ?realmId=, the company id every Accounting
//    API call is scoped to.

import {
  getOAuthConfig,
  QBO_AUTHORIZE_URL,
  QBO_REVOKE_URL,
  QBO_SCOPES,
  QBO_TOKEN_URL,
} from './config';

export interface QuickBooksTokenData {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms; access tokens live ~1 hour. */
  accessTokenExpiresAt: number;
  /** Epoch ms; refresh tokens live ~100 days, extended on every refresh. */
  refreshTokenExpiresAt: number;
}

interface IntuitTokenResponse {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}

/** httpOnly cookie carrying `state` between /connect and /callback. */
export const QBO_STATE_COOKIE = 'qbo_oauth_state';

/** Cryptographically random `state` for the authorize redirect. */
export function generateState(): string {
  return crypto.randomUUID();
}

export function buildAuthorizationUrl(requestUrl: URL, state: string): string {
  const { clientId, redirectUri } = getOAuthConfig(requestUrl);

  const params = new URLSearchParams({
    client_id: clientId,
    scope: QBO_SCOPES,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });

  return `${QBO_AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

async function requestTokens(
  body: URLSearchParams,
  config: { clientId: string; clientSecret: string },
  label: string
): Promise<QuickBooksTokenData> {
  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(config.clientId, config.clientSecret),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[QuickBooks] ${label} failed:`, response.status, errorText.substring(0, 200));
    throw new Error(`QuickBooks ${label} failed: ${response.status}`);
  }

  const data: IntuitTokenResponse = await response.json();
  if (!data.access_token || !data.refresh_token) {
    throw new Error(`QuickBooks ${label} returned no tokens`);
  }

  const now = Date.now();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessTokenExpiresAt: now + (data.expires_in ?? 3600) * 1000,
    refreshTokenExpiresAt: now + (data.x_refresh_token_expires_in ?? 8_726_400) * 1000,
  };
}

export async function exchangeCodeForTokens(
  requestUrl: URL,
  code: string
): Promise<QuickBooksTokenData> {
  const config = getOAuthConfig(requestUrl);
  return requestTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
    config,
    'code exchange'
  );
}

export async function refreshTokens(currentRefreshToken: string): Promise<QuickBooksTokenData> {
  const config = getOAuthConfig();
  return requestTokens(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentRefreshToken,
    }),
    config,
    'token refresh'
  );
}

/**
 * Revoke a refresh token (kills the whole grant — access tokens included).
 * Used by the disconnect path before the stored row is deleted.
 */
export async function revokeToken(refreshToken: string): Promise<void> {
  const { clientId, clientSecret } = getOAuthConfig();

  const response = await fetch(QBO_REVOKE_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: refreshToken }),
  });

  // Intuit answers 200 on success; a failed revoke shouldn't strand the
  // disconnect flow, so log and continue — the row delete still happens.
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[QuickBooks] revoke failed:', response.status, errorText.substring(0, 200));
  }
}

/** Expired or about to expire (within 5 minutes by default). */
export function isTokenExpired(expiresAt: number, bufferMs: number = 5 * 60 * 1000): boolean {
  return Date.now() >= expiresAt - bufferMs;
}
