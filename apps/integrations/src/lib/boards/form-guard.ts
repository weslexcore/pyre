// What stands between a public form and a board: a honeypot, a clock, and
// a per-address counter. Server-only, for the Redis; the two pure checks
// are exported so they can be tested without it.
//
// None of this is a wall. A honeypot catches the crawler that fills every
// field; the clock catches the script that posts the instant the page
// loads; the counter caps what one address can file in a window. Together
// they keep a public form from turning a board into a spam folder without
// asking a person to prove anything. The counter fails open when Redis is
// not configured — a missing KV env var should not close the form.

import { getRedis } from '@pyre/webhook-core';

/** Nobody reads a form and answers it in under three seconds. */
export const MIN_FILL_MS = 3000;

/** Ten submissions from one address in ten minutes is not a person. */
export const FORM_RATE = { limit: 10, windowSeconds: 600 } as const;

/** The field name the honeypot input carries. */
export const HONEYPOT_FIELD = 'website';

// getRedis() warns on every call when the KV env vars are absent, so resolve
// the client once per module rather than per request.
let redisClient: ReturnType<typeof getRedis> | undefined;
function redis(): ReturnType<typeof getRedis> {
  if (redisClient === undefined) redisClient = getRedis();
  return redisClient;
}

export function rateKey(ip: string): string {
  return `forms:rl:ip:${ip}`;
}

/** true = over the limit. Fails open when Redis is unconfigured or down. */
export async function isRateLimited(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const client = redis();
  if (!client) return false;
  try {
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, windowSeconds);
    return count > limit;
  } catch {
    return false;
  }
}

/** A failure on our side should not burn the caller's quota. Best effort. */
export async function refundRateLimit(key: string): Promise<void> {
  const client = redis();
  if (!client) return;
  try {
    await client.decr(key);
  } catch {
    // best-effort
  }
}

/**
 * The address a request came from: the first hop in x-forwarded-for (what
 * Vercel sets), then x-real-ip, then whatever the adapter knows. 'unknown'
 * puts every unidentifiable caller in one bucket, which is the safe side.
 */
export function clientIp(request: Request, clientAddress?: () => string): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  try {
    const address = clientAddress?.().trim();
    if (address) return address;
  } catch {
    // Some adapters throw when they cannot tell.
  }
  return 'unknown';
}

/** A form posted before a person could have read it. */
export function tooFast(startedAt: unknown, now = Date.now()): boolean {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return true;
  return now - startedAt < MIN_FILL_MS;
}

/** The hidden field a person never sees, filled in. */
export function honeypotTripped(body: Record<string, unknown>): boolean {
  const value = body[HONEYPOT_FIELD];
  return typeof value === 'string' && value.trim().length > 0;
}
