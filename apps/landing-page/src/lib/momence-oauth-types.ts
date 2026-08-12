// TypeScript interfaces for Momence OAuth V2

/**
 * OAuth token response from Momence
 */
export interface MomenceTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number; // seconds until expiry
  refresh_token: string;
  scope: string;
}

/**
 * Stored token data with computed expiry time
 */
export interface MomenceTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  scope: string;
  userId?: number; // User ID from Momence
}

/**
 * User profile from Momence OAuth
 */
export interface MomenceUserProfile {
  id: number;
  /**
   * Momence host member id (nullable in AuthProfileDto). Distinct from `id`
   * (the OAuth user id) — host-API calls and webhooks key on THIS id.
   */
  memberId?: number | null;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatarUrl?: string;
}

/**
 * OAuth state stored in cookie for CSRF protection
 */
export interface OAuthState {
  state: string;
  codeVerifier?: string; // For PKCE if supported
  returnUrl?: string;
}

/**
 * Auth session data returned to client
 */
export interface AuthSession {
  isAuthenticated: boolean;
  user: MomenceUserProfile | null;
  expiresAt: number | null;
}

/**
 * OAuth prompt types
 * - 'login': Show login form (default)
 * - 'sign-up': Show registration form
 * - 'none': Skip if already authenticated
 */
export type OAuthPrompt = 'login' | 'sign-up' | 'none';

/**
 * Request payload for updating user profile
 */
export interface UpdateProfileRequest {
  phone?: string;
}

/**
 * Response from profile update API
 */
export interface UpdateProfileResponse {
  success: boolean;
  user?: MomenceUserProfile;
  useLocalStorage?: boolean; // True if API update not supported, use localStorage fallback
  error?: string;
}

/**
 * Local profile overrides stored in localStorage
 * Used as fallback when Momence API doesn't support profile updates
 */
export interface LocalProfileOverrides {
  phone?: string;
  updatedAt: number; // Unix timestamp
}
