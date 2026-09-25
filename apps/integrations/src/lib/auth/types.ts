// Session types for the admin dashboard. The session comes from Supabase Auth;
// Momence OAuth survives only as the cutover path for staff who haven't set a
// Supabase password yet (see ./session.ts).

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

/**
 * The signed-in person, whichever way they signed in. `id` is the Supabase
 * auth user id (uuid), or the Momence user id as a string on a cutover
 * session. Access checks key on `email`, never `id`.
 */
export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * 'supabase' = the real session. 'momence' = a cutover session: the person
 * proved who they are through Momence but hasn't set a Supabase password, so
 * all they may do is set one (middleware + requireAccess enforce that).
 */
export type SessionSource = 'supabase' | 'momence';

/** OAuth state stored in a short-lived cookie for CSRF protection. */
export interface OAuthState {
  state: string;
  returnUrl?: string;
  /** The email typed on the login page, to flag a different Momence account. */
  email?: string;
}

export interface AuthSession {
  isAuthenticated: boolean;
  user: SessionUser | null;
  expiresAt: number | null;
  source: SessionSource | null;
}
