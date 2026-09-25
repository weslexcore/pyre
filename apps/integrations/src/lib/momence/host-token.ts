// The host access token every Momence host-API call runs on: a password
// grant as the Momence service account, refreshed while the refresh token
// lasts and cached per lambda instance. Server-only.

import { createWebhookLogger } from '@pyre/webhook-core';

const log = createWebhookLogger('Momence');

export const MOMENCE_API_V2 = 'https://api.momence.com/api/v2';

let cachedToken: { accessToken: string; refreshToken: string; expiresAt: number } | null = null;

export async function getHostAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  // Try refresh first if we have a refresh token
  if (cachedToken?.refreshToken) {
    try {
      const token = await exchangeToken({
        grant_type: 'refresh_token',
        refresh_token: cachedToken.refreshToken,
      });
      return token;
    } catch {
      log.warn('Refresh token failed, falling back to password grant');
      cachedToken = null;
    }
  }

  // Password grant
  const hostEmail = import.meta.env.MOMENCE_HOST_EMAIL;
  const hostPassword = import.meta.env.MOMENCE_HOST_PASSWORD;

  if (!hostEmail || !hostPassword) {
    throw new Error(
      'Missing Momence host credentials (MOMENCE_HOST_EMAIL or MOMENCE_HOST_PASSWORD)'
    );
  }

  return exchangeToken({
    grant_type: 'password',
    username: hostEmail,
    password: hostPassword,
    // Same scope the interactive OAuth flow requests — without it the token
    // gets Momence's default scope, which 403s on /host/reports.
    scope: 'public-api-v2',
  });
}

async function exchangeToken(params: Record<string, string>): Promise<string> {
  const clientId = import.meta.env.MOMENCE_OAUTH_CLIENT_ID;
  const clientSecret = import.meta.env.MOMENCE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing Momence OAuth credentials (MOMENCE_OAUTH_CLIENT_ID or MOMENCE_OAUTH_CLIENT_SECRET)'
    );
  }

  log.info(`Token exchange via ${params.grant_type}`);

  const response = await fetch(`${MOMENCE_API_V2}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    log.error(`Token exchange failed: status=${response.status} body=${body}`);
    throw new Error(`Momence token exchange failed: ${response.status}`);
  }

  const data = await response.json();
  const accessToken = data.access_token || data.accessToken;
  const refreshToken = data.refresh_token || data.refreshToken;
  const expiresIn = data.expires_in || data.expiresIn || 3600;

  cachedToken = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  log.info('Host access token obtained successfully');
  return accessToken;
}
