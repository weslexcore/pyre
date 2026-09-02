import { createHmac, timingSafeEqual } from 'node:crypto';

// Binds a knowledge-assistant Eve session to the staff member who opened it.
// The ask API hands the browser a token alongside the session id; follow-ups
// and stream reads must present it, so nobody can attach to (or continue)
// somebody else's conversation by guessing a session id. Same HMAC shape as
// lib/schedule/sub-token.ts, keyed on the channel secret the feature already
// requires — no extra env var to provision.

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

function getSecret(): string | null {
  // process.env fallback: vars added after the cached build only exist at runtime.
  return import.meta.env.EVE_CHANNEL_SECRET ?? process.env.EVE_CHANNEL_SECRET ?? null;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', `ask-session:${secret}`).update(payload).digest('base64url');
}

export function createAskSessionToken(sessionId: string, email: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const payload: AskSessionPayload = { sid: sessionId, email, exp: Date.now() + TOKEN_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

/**
 * Whether `token` binds `sessionId` to `email` and is still current. Any
 * failure is just "invalid": the caller starts a fresh session either way.
 */
export function verifyAskSessionToken(token: string, sessionId: string, email: string): boolean {
  const secret = getSecret();
  if (!secret) return false;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return false;

  const expected = sign(encoded, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  let payload: AskSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return false;
  }

  return (
    typeof payload.sid === 'string' &&
    typeof payload.email === 'string' &&
    typeof payload.exp === 'number' &&
    payload.sid === sessionId &&
    payload.email === email &&
    Date.now() <= payload.exp
  );
}
