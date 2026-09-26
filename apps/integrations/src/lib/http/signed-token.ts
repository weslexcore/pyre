import { createHmac, timingSafeEqual } from 'node:crypto';

// The one construction behind every signed link and session token this app
// issues: `<base64url(payload)>.<base64url(hmac-sha256)>`. Each token module
// (unsubscribe, claim, calendar, partner decision, sub claim, ask session)
// supplies its secret and what goes in the payload; the encoding, signing and
// constant-time check live here. Changing anything below changes the wire
// format of links already sitting in inboxes — don't.

export interface SigningOptions {
  /** The HMAC secret, or null when unconfigured (every sign/verify fails). */
  secret: () => string | null | undefined;
  /** Prepended to the secret to derive a per-purpose key. */
  keyPrefix?: string;
  /** Prepended to the encoded payload before signing. */
  messagePrefix?: string;
}

/**
 * The secret chain the email links (unsubscribe, lost-found claim, calendar)
 * share. No process.env fallback, matching how they have always read it.
 */
export function emailLinkSecret(): string | null {
  return import.meta.env.UNSUBSCRIBE_SECRET ?? import.meta.env.CRON_SECRET ?? null;
}

function sign(encoded: string, secret: string, opts: SigningOptions): string {
  return createHmac('sha256', `${opts.keyPrefix ?? ''}${secret}`)
    .update(`${opts.messagePrefix ?? ''}${encoded}`)
    .digest('base64url');
}

/** Sign a raw string payload. Null when no secret is configured. */
export function signString(value: string, opts: SigningOptions): string | null {
  const secret = opts.secret();
  if (!secret) return null;
  const encoded = Buffer.from(value).toString('base64url');
  return `${encoded}.${sign(encoded, secret, opts)}`;
}

/** The payload string of a genuine token, or null. */
export function verifyString(token: string, opts: SigningOptions): string | null {
  const secret = opts.secret();
  if (!secret) return null;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const a = Buffer.from(signature);
  const b = Buffer.from(sign(encoded, secret, opts));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/** Sign a JSON payload. Null when no secret is configured. */
export function signJson(payload: unknown, opts: SigningOptions): string | null {
  return signString(JSON.stringify(payload), opts);
}

/**
 * The parsed payload of a genuine token, or null. Unvalidated: the caller
 * checks its shape.
 */
export function verifyJson(token: string, opts: SigningOptions): unknown {
  const raw = verifyString(token, opts);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;
