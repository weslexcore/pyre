// Momence OAuth V2 helpers
// Handles authorization URL generation, token exchange, and refresh

import type {
  MomenceTokenData,
  MomenceTokenResponse,
  MomenceUserProfile,
  OAuthPrompt,
} from './momence-oauth-types';

const MOMENCE_OAUTH_BASE = 'https://api.momence.com/api/v2/auth';

/**
 * Get OAuth client credentials from environment
 */
function getOAuthConfig() {
  const clientId = import.meta.env.MOMENCE_OAUTH_CLIENT_ID;
  const clientSecret = import.meta.env.MOMENCE_OAUTH_CLIENT_SECRET;
  const redirectUri = import.meta.env.PUBLIC_MOMENCE_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing Momence OAuth configuration. Check environment variables.');
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * Generate a cryptographically secure random state string
 */
export function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the Momence OAuth authorization URL
 */
export function buildAuthorizationUrl(
  state: string,
  prompt: OAuthPrompt = 'login',
  returnUrl?: string
): string {
  const { clientId, redirectUri } = getOAuthConfig();

  console.log('[OAuth] Building authorization URL...');
  console.log('[OAuth] Client ID:', clientId);
  console.log('[OAuth] Redirect URI:', redirectUri);
  console.log('[OAuth] State:', state);
  console.log('[OAuth] Prompt:', prompt);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'public-api-v2',
    state,
    prompt,
  });

  // Store return URL in state if provided (will be parsed from state cookie)
  // The state parameter itself is just for CSRF protection

  const authUrl = `${MOMENCE_OAUTH_BASE}/authorize?${params.toString()}`;
  console.log('[OAuth] Authorization URL:', authUrl);

  return authUrl;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<MomenceTokenData> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();

  console.log('[OAuth] Exchanging code for tokens...');
  console.log('[OAuth] Token endpoint:', `${MOMENCE_OAUTH_BASE}/token`);
  console.log('[OAuth] Client ID:', clientId);
  console.log('[OAuth] Redirect URI:', redirectUri);
  console.log('[OAuth] Code (first 10 chars):', code.substring(0, 10) + '...');

  const requestBody = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  console.log('[OAuth] Request body (without secret):', {
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code: code.substring(0, 10) + '...',
  });

  const response = await fetch(`${MOMENCE_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: requestBody,
  });

  console.log('[OAuth] Token response status:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] Token exchange failed:', response.status, errorText);
    console.error('[OAuth] Response headers:', Object.fromEntries(response.headers.entries()));
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('[OAuth] Full token response:', JSON.stringify(data, null, 2));
  console.log('[OAuth] Token response received, access_token present:', !!data.access_token);
  console.log('[OAuth] Token expires_in:', data.expires_in);
  console.log('[OAuth] Token expiresIn:', data.expiresIn);

  // Handle different response formats - Momence might use camelCase or snake_case
  const accessToken = data.access_token || data.accessToken;
  const refreshToken = data.refresh_token || data.refreshToken;
  const expiresIn = data.expires_in || data.expiresIn || 3600; // Default to 1 hour if not provided
  const scope = data.scope || '';

  if (!accessToken) {
    console.error('[OAuth] No access token in response');
    throw new Error('No access token in response');
  }

  // Extract user ID from response
  const userId = data.user?.id || data.userId || data.user_id;
  console.log('[OAuth] User ID from token response:', userId);

  console.log('[OAuth] Parsed tokens - accessToken present:', !!accessToken, 'refreshToken present:', !!refreshToken, 'expiresIn:', expiresIn, 'userId:', userId);

  return {
    accessToken,
    refreshToken: refreshToken || '',
    expiresAt: Date.now() + expiresIn * 1000,
    scope,
    userId,
  };
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(currentRefreshToken: string): Promise<MomenceTokenData> {
  const { clientId, clientSecret } = getOAuthConfig();

  const response = await fetch(`${MOMENCE_OAUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: currentRefreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] Token refresh failed:', response.status, errorText);
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data: MomenceTokenResponse = await response.json();

  // Handle different response formats - API might use camelCase or snake_case
  // If no new refresh token is provided, keep using the original one
  const accessToken = data.access_token || (data as any).accessToken;
  const newRefreshToken = data.refresh_token || (data as any).refreshToken || currentRefreshToken;
  const expiresIn = data.expires_in || (data as any).expiresIn || 3600;
  const scope = data.scope || '';

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scope,
  };
}

/**
 * Fetch user profile using access token
 * Tries multiple endpoints since Momence API structure may vary
 */
export async function fetchUserProfile(accessToken: string): Promise<MomenceUserProfile> {
  // List of endpoints to try for fetching user profile
  const endpoints = [
    'https://api.momence.com/api/v2/member',
    'https://api.momence.com/api/v2/members/me',
    'https://api.momence.com/api/v2/user',
    'https://api.momence.com/api/v2/users/me',
    'https://api.momence.com/api/v2/me',
    'https://api.momence.com/api/v2/auth/me',
  ];

  for (const endpoint of endpoints) {
    console.log('[OAuth] Trying profile endpoint:', endpoint);

    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      console.log('[OAuth] Profile response from', endpoint, '- status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('[OAuth] Profile data from', endpoint, ':', JSON.stringify(data, null, 2));

        // Handle different response structures
        const profile = data.user || data.member || data;

        return {
          id: profile.id || profile.userId || profile.memberId,
          email: profile.email || profile.emailAddress || '',
          firstName: profile.firstName || profile.first_name || profile.name?.split(' ')[0] || 'User',
          lastName: profile.lastName || profile.last_name || profile.name?.split(' ').slice(1).join(' ') || '',
          phone: profile.phone || profile.phoneNumber || profile.phone_number,
          avatarUrl: profile.avatarUrl || profile.avatar || profile.profileImage || profile.image,
        };
      }

      // Log non-200 responses but continue trying other endpoints
      const errorText = await response.text();
      console.log('[OAuth] Profile endpoint returned', response.status, ':', errorText.substring(0, 200));
    } catch (err) {
      console.log('[OAuth] Error fetching from', endpoint, ':', err);
    }
  }

  // If no endpoint worked, throw an error
  console.error('[OAuth] All profile endpoints failed');
  throw new Error('Could not fetch user profile from any endpoint');
}

/**
 * Check if token is expired or about to expire (within 5 minutes)
 */
export function isTokenExpired(expiresAt: number, bufferMs: number = 5 * 60 * 1000): boolean {
  return Date.now() >= expiresAt - bufferMs;
}

/**
 * Build Momence logout URL
 */
export function buildLogoutUrl(returnUrl?: string): string {
  const params = new URLSearchParams();
  if (returnUrl) {
    params.set('redirect_uri', returnUrl);
  }
  const queryString = params.toString();
  return `${MOMENCE_OAUTH_BASE}/logout${queryString ? `?${queryString}` : ''}`;
}
