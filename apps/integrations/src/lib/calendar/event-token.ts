import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed, stateless payloads for the hosted .ics endpoint. The event data
// travels inside the token (rather than a sessionId lookup) because the
// Momence Events feed only lists *upcoming* sessions — calendar links get
// clicked from old emails long after the event drops off the feed. Signing
// matters: an unsigned encoder would let anyone serve arbitrary crafted
// calendar events from our domain. Same secret chain as unsubscribe-token.ts.

export interface CalendarTokenPayload {
  v: 1;
  title: string;
  /** ISO 8601 UTC */
  start: string;
  /** ISO 8601 UTC */
  end: string;
}

function getSecret(): string | null {
  return import.meta.env.UNSUBSCRIBE_SECRET ?? import.meta.env.CRON_SECRET ?? null;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createCalendarToken(payload: CalendarTokenPayload): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, secret)}`;
}

function isValidIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

export function verifyCalendarToken(token: string): CalendarTokenPayload | null {
  const secret = getSecret();
  if (!secret) return null;

  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = sign(encoded, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) return null;
  const { v, title, start, end } = payload as Record<string, unknown>;
  if (v !== 1) return null;
  if (typeof title !== 'string' || title.length === 0 || title.length > 200) return null;
  if (!isValidIso(start) || !isValidIso(end)) return null;
  if (new Date(end).getTime() <= new Date(start).getTime()) return null;

  return { v: 1, title, start, end };
}
