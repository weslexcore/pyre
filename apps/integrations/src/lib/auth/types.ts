// The signed-in person, as the rest of the app sees them. Built from the
// verified Supabase JWT (lib/auth/session); the email is what every row is
// attributed to and what the staff table is matched on.

export interface SessionUser {
  /** auth.users.id */
  id: string;
  /** Lowercased. */
  email: string;
  /** From the auth user's metadata (set from staff.display_name), else the email's local part. */
  displayName: string;
  /** displayName split on its first space — for "filed by" lines. */
  firstName: string;
  lastName: string;
}

export interface AuthSession {
  isAuthenticated: boolean;
  user: SessionUser | null;
  /** Epoch ms the access token expires; the session refreshes itself before then. */
  expiresAt: number | null;
}

export interface ValidatedSession {
  session: AuthSession;
  /** The verified access token, for handing to the browser's Realtime client. Null when signed out. */
  accessToken: string | null;
}
