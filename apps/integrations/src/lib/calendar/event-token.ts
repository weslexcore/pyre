import { emailLinkSecret, signJson, verifyJson } from '@/lib/http/signed-token';

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

const SIGNING = { secret: emailLinkSecret };

export function createCalendarToken(payload: CalendarTokenPayload): string | null {
  return signJson(payload, SIGNING);
}

function isValidIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

export function verifyCalendarToken(token: string): CalendarTokenPayload | null {
  const payload = verifyJson(token, SIGNING);
  if (typeof payload !== 'object' || payload === null) return null;
  const { v, title, start, end } = payload as Record<string, unknown>;
  if (v !== 1) return null;
  if (typeof title !== 'string' || title.length === 0 || title.length > 200) return null;
  if (!isValidIso(start) || !isValidIso(end)) return null;
  if (new Date(end).getTime() <= new Date(start).getTime()) return null;

  return { v: 1, title, start, end };
}
