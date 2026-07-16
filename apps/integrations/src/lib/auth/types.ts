// Momence OAuth types — trimmed port of apps/landing-page/src/lib/momence-oauth-types.ts
// (only what the admin dashboard's auth flow needs).

export interface MomenceTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number; // seconds until expiry
  refresh_token: string;
  scope: string;
}

/** Stored token data with computed expiry time. */
export interface MomenceTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  scope: string;
  userId?: number;
}

export interface MomenceUserProfile {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
}

/** OAuth state stored in a short-lived cookie for CSRF protection. */
export interface OAuthState {
  state: string;
  returnUrl?: string;
}

export interface AuthSession {
  isAuthenticated: boolean;
  user: MomenceUserProfile | null;
  expiresAt: number | null;
}
