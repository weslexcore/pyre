import { signJson, verifyJson } from '@/lib/http/signed-token';

// Binds a knowledge-assistant Eve session to the staff member who opened it.
// The ask API hands the browser a token alongside the session id; follow-ups
// and stream reads must present it, so nobody can attach to (or continue)
// somebody else's conversation by guessing a session id. Keyed on the channel
// secret the feature already requires — no extra env var to provision.

interface AskSessionPayload {
  /** Eve session id */
  sid: string;
  /** Session email of the staff member who opened it, lowercased. */
  email: string;
  /** unix ms expiry */
  exp: number;
}

/** A conversation is resumable for this long; Eve's own retention is the real bound. */
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const SIGNING = {
  // process.env fallback: vars added after the cached build only exist at runtime.
  secret: () => import.meta.env.EVE_CHANNEL_SECRET ?? process.env.EVE_CHANNEL_SECRET,
  keyPrefix: 'ask-session:',
};

export function createAskSessionToken(sessionId: string, email: string): string | null {
  const payload: AskSessionPayload = { sid: sessionId, email, exp: Date.now() + TOKEN_TTL_MS };
  return signJson(payload, SIGNING);
}

/**
 * Whether `token` binds `sessionId` to `email` and is still current. Any
 * failure is just "invalid": the caller starts a fresh session either way.
 */
export function verifyAskSessionToken(token: string, sessionId: string, email: string): boolean {
  const payload = verifyJson(token, SIGNING) as Partial<AskSessionPayload> | null;
  return (
    !!payload &&
    typeof payload.sid === 'string' &&
    typeof payload.email === 'string' &&
    typeof payload.exp === 'number' &&
    payload.sid === sessionId &&
    payload.email === email &&
    Date.now() <= payload.exp
  );
}
