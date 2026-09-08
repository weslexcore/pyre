// Shared shapes for the special-event conflict check: what the detector
// reports, what an admin decided about each session, and the constants the
// job, the store, the route, the email, and the island all agree on.
//
// Momence is the source of truth for sessions; these are snapshots of what
// the detector saw when it looked, stored so the admin reviews the same list
// the email described.

/** How far ahead the detector looks, in ET calendar days from today. */
export const HORIZON_DAYS = 28;

/**
 * Session types (see TAG_TO_TYPE in lib/momence-events.ts) that are the
 * recurring, stacked sessions a special event sits on top of. These are
 * pre-selected for cancellation; every other overlapping session is listed
 * but left unchecked, so a guided session or a yoga class never gets
 * cancelled by a default.
 */
export const PRESELECT_TYPES: readonly string[] = ['open hours', 'social'];

/** The admin page where a review is acted on. */
export const SESSION_CONFLICTS_PAGE = '/admin/session-conflicts';

export interface ConflictSpecialEvent {
  id: number;
  title: string;
  /** ISO 8601 UTC. */
  startsAt: string;
  endsAt: string;
  location: string | null;
  /** Momence's public page for the event, when the feed carries one. */
  link: string | null;
}

export interface ConflictSession {
  id: number;
  title: string;
  /** The recognised Momence tag, in its original spelling; null when untagged. */
  tag: string | null;
  /** Canonical type from sessionTypeForTags(): 'open hours', 'social', 'guided', ..., 'general'. */
  type: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  /** Seats taken, when the feed lets us tell; null when it doesn't. */
  bookingCount: number | null;
  capacity: number | null;
  link: string | null;
  /** True for the recurring types the check exists for (PRESELECT_TYPES). */
  preselected: boolean;
}

/** One special event and every regular session overlapping it. */
export interface SessionConflict {
  specialEvent: ConflictSpecialEvent;
  sessions: ConflictSession[];
}

export type ResolutionOutcome = 'cancelled' | 'failed' | 'unsupported' | 'skipped' | 'cleared';

export interface ResolutionEntry {
  outcome: ResolutionOutcome;
  /** Human-readable detail: the Momence error, or why it was left alone. */
  message?: string;
  /** The Momence route that did the cancelling, e.g. "POST /host/sessions/{id}/cancel". */
  via?: string;
  /** ISO timestamp of the decision. */
  at: string;
  /** Dashboard email of the admin, or 'cron'. */
  by: string;
}

/** Momence session id -> what happened to it. Keys are strings (JSON). */
export type Resolution = Record<string, ResolutionEntry>;

/**
 * Outcomes that close a session's part of the review. `failed` and
 * `unsupported` are not on this list on purpose: the review stays open until
 * the admin retries, or marks it handled after dealing with it in Momence.
 */
export const HANDLED_OUTCOMES: readonly ResolutionOutcome[] = ['cancelled', 'skipped', 'cleared'];

export function isHandled(entry: ResolutionEntry | undefined): boolean {
  return entry !== undefined && HANDLED_OUTCOMES.includes(entry.outcome);
}

export type ReviewStatus = 'pending' | 'resolved' | 'clear' | 'superseded';
export type ReviewSource = 'cron' | 'manual';

/** What the host API knows about cancelling sessions on this account. */
export type CancelSupport = 'unknown' | 'supported' | 'unsupported';
