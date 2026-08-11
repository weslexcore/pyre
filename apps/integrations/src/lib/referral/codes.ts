// Referral code generation + click counting. Codes are human-speakable
// ("use WES15") rather than opaque shortlink slugs, because the /r/{code}
// landing page renders the referrer's name server-side and the code doubles as
// something a customer can say out loud at the front desk.

import { getRedis } from '@pyre/webhook-core';

const CODE_PATTERN = /^[A-Z0-9]{3,16}$/;

/** Uppercase letters only, from whatever the first name contains. */
function namePart(firstName: string): string {
  const letters = firstName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics so "José" -> "JOSE"
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 10);
  // A name with no usable letters still needs a base ("李" or emoji names).
  return letters || 'PYRE';
}

function randomDigits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}

/**
 * Candidate codes for a first name: FIRSTNAME + 2 digits, widening to 3 digits
 * after repeated collisions, then a fully random suffix as the last resort.
 * The caller owns collision detection (the unique index on referrers.code) and
 * walks this sequence until an insert sticks.
 */
export function codeCandidates(firstName: string, attempts = 8): string[] {
  const base = namePart(firstName);
  const candidates: string[] = [];
  for (let i = 0; i < attempts; i += 1) {
    const digits = i < 3 ? randomDigits(2) : randomDigits(3);
    candidates.push(`${base}${digits}`.slice(0, 16));
  }
  // Last resort keeps the name prefix short so the random tail dominates.
  candidates.push(`${base.slice(0, 6)}${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
  return candidates.filter((c) => CODE_PATTERN.test(c));
}

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

// --- Click counting ---
//
// Redis counter so /account stats don't need a PostHog query. PostHog gets a
// referral_link_clicked event separately (client-side on the /r page) for
// funnel analysis; this counter is the cheap always-available number.

const CLICKS_PREFIX = 'referral:clicks:';

export async function incrementReferralClicks(code: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.incr(`${CLICKS_PREFIX}${normalizeCode(code)}`);
  } catch {
    // A lost click count must never break the landing page.
  }
}

export async function getReferralClicks(code: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const value = await redis.get<number>(`${CLICKS_PREFIX}${normalizeCode(code)}`);
    return value ?? 0;
  } catch {
    return 0;
  }
}
