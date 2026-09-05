// Shape-checking for lost-and-found writes. Pure and client-bundle-safe: the
// form imports FIELD_LIMITS to cap its own inputs at the same numbers the
// server rejects at.
//
// Identity columns (logged_by, picked_up_by, donated_by, claimed_by_*) are set
// by the route from the session and are deliberately absent from this table —
// a request body must never be able to reach them. Neither may `status`: it
// moves through the dedicated status path, which writes an audit event.

import { DEFAULT_LOOKBACK_HOURS, DONATION_WINDOW_DAYS, MAX_WINDOW_HOURS } from './types';

export const FIELD_LIMITS = {
  title: 200,
  description: 2000,
  storageLocation: 200,
  areaDetail: 300,
  note: 1000,
  personName: 200,
  email: 320,
} as const;

export type Normalized<T> = { ok: true; value: T } | { ok: false; error: string };

const HOUR_MS = 3_600_000;

/** Sessions staff may pick in one log. A day of classes, with room to spare. */
const MAX_CHOSEN_SESSIONS = 50;
const SESSION_ID_MAX = 64;

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Momence session ids off the log form. Ids only — they say who *may* be
 * emailed later, and the notify route re-derives that set from the item's
 * window anyway, so a crafted list here widens nothing.
 */
function sessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > SESSION_ID_MAX || ids.includes(trimmed)) continue;
    ids.push(trimmed);
    if (ids.length === MAX_CHOSEN_SESSIONS) break;
  }
  return ids;
}

/** Basic shape only — the mail provider is the real judge of an address. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= FIELD_LIMITS.email;
}

export interface ItemSubmission {
  title: string;
  description: string | null;
  storage_location: string | null;
  found_at: string;
  left_window_start: string;
  left_window_end: string;
  chosen_session_ids: string[];
  donate_after: string;
  owner_member_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  /**
   * The guest already told us it's theirs, so the log is the whole job and
   * nobody gets emailed. It is a fact about the item, not a status: the route
   * derives the status from it, which is what keeps `status` off the body.
   */
  owner_confirmed: boolean;
}

/**
 * A new item off the log form. `found_at` is the only timestamp staff must
 * supply; the left-in window defaults to the hours before it, and the donation
 * deadline is always derived — never taken from the body, so the 30-day policy
 * can't be shortened by a crafted request.
 */
export function normalizeItemSubmission(body: Record<string, unknown>): Normalized<ItemSubmission> {
  const title = text(body.title, FIELD_LIMITS.title);
  if (!title) return { ok: false, error: 'Say what the item is' };

  const foundAt = timestamp(body.foundAt) ?? new Date().toISOString();
  const foundMs = Date.parse(foundAt);
  if (foundMs > Date.now() + HOUR_MS) {
    return { ok: false, error: "An item can't be found in the future" };
  }

  const windowStart =
    timestamp(body.leftWindowStart) ??
    new Date(foundMs - DEFAULT_LOOKBACK_HOURS * HOUR_MS).toISOString();
  const windowEnd = timestamp(body.leftWindowEnd) ?? foundAt;

  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (endMs < startMs) return { ok: false, error: 'The window ends before it starts' };
  if (endMs - startMs > MAX_WINDOW_HOURS * HOUR_MS) {
    return { ok: false, error: `Keep the window under ${MAX_WINDOW_HOURS} hours` };
  }

  const ownerEmail = text(body.ownerEmail, FIELD_LIMITS.email)?.toLowerCase() ?? null;
  if (ownerEmail && !looksLikeEmail(ownerEmail)) {
    return { ok: false, error: "That owner email doesn't look right" };
  }

  // "They told us it's theirs" with nobody named is a contradiction, and
  // quietly dropping it would log the item as unclaimed and put it on the
  // donation pile — the one outcome this flag exists to prevent.
  const ownerConfirmed = body.ownerConfirmed === true;
  if (ownerConfirmed && !ownerEmail) {
    return { ok: false, error: 'Say whose it is before marking it theirs' };
  }

  return {
    ok: true,
    value: {
      title,
      description: text(body.description, FIELD_LIMITS.description),
      storage_location: text(body.storageLocation, FIELD_LIMITS.storageLocation),
      found_at: foundAt,
      left_window_start: windowStart,
      left_window_end: windowEnd,
      chosen_session_ids: sessionIds(body.sessionIds),
      donate_after: new Date(foundMs + DONATION_WINDOW_DAYS * 24 * HOUR_MS).toISOString(),
      owner_member_id: text(body.ownerMemberId, 64),
      owner_name: text(body.ownerName, FIELD_LIMITS.personName),
      owner_email: ownerEmail,
      owner_confirmed: ownerConfirmed,
    },
  };
}

/**
 * Fields an edit may touch. `status` and every identity column are excluded.
 * `owner_confirmed` is in the type but never read off the body: confirming an
 * owner moves the status too, so it has its own path in the route, and the
 * only thing an edit does with it is clear it when the owner is cleared.
 */
export type ItemPatch = Partial<
  Pick<
    ItemSubmission,
    | 'title'
    | 'description'
    | 'storage_location'
    | 'left_window_start'
    | 'left_window_end'
    | 'owner_member_id'
    | 'owner_name'
    | 'owner_email'
    | 'owner_confirmed'
  >
>;

export function normalizeItemPatch(body: Record<string, unknown>): Normalized<ItemPatch> {
  const patch: ItemPatch = {};

  if ('title' in body) {
    const title = text(body.title, FIELD_LIMITS.title);
    if (!title) return { ok: false, error: 'Say what the item is' };
    patch.title = title;
  }
  if ('description' in body) patch.description = text(body.description, FIELD_LIMITS.description);
  if ('storageLocation' in body) {
    patch.storage_location = text(body.storageLocation, FIELD_LIMITS.storageLocation);
  }
  if ('ownerEmail' in body) {
    const ownerEmail = text(body.ownerEmail, FIELD_LIMITS.email)?.toLowerCase() ?? null;
    if (ownerEmail && !looksLikeEmail(ownerEmail)) {
      return { ok: false, error: "That owner email doesn't look right" };
    }
    patch.owner_email = ownerEmail;
    // Whoever the record said it belonged to is gone, so the note saying they
    // told us so goes with them. Leaving it set would show "we know this is
    // theirs" over an empty name.
    if (!ownerEmail) patch.owner_confirmed = false;
  }
  if ('ownerName' in body) patch.owner_name = text(body.ownerName, FIELD_LIMITS.personName);
  if ('ownerMemberId' in body) patch.owner_member_id = text(body.ownerMemberId, 64);

  const hasStart = 'leftWindowStart' in body;
  const hasEnd = 'leftWindowEnd' in body;
  if (hasStart || hasEnd) {
    const start = hasStart ? timestamp(body.leftWindowStart) : null;
    const end = hasEnd ? timestamp(body.leftWindowEnd) : null;
    if (hasStart && !start) return { ok: false, error: 'leftWindowStart must be a date' };
    if (hasEnd && !end) return { ok: false, error: 'leftWindowEnd must be a date' };
    if (start && end && Date.parse(end) < Date.parse(start)) {
      return { ok: false, error: 'The window ends before it starts' };
    }
    if (start) patch.left_window_start = start;
    if (end) patch.left_window_end = end;
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to change' };
  return { ok: true, value: patch };
}

/** Field-by-field before/after for the audit trail. Unchanged fields are dropped. */
export function diffItemFields(
  before: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, next] of Object.entries(patch)) {
    const prev = before[key] ?? null;
    if ((prev ?? null) !== (next ?? null)) diff[key] = { from: prev ?? null, to: next ?? null };
  }
  return diff;
}
