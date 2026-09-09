// Shared shapes for the schedule lint: what one rule reports, what the whole
// run reports, and the constants the rules, the job, the email, and the
// webhook trigger all agree on.
//
// Momence is the source of truth for the schedule. Nothing here is stored —
// a run reads the feed, computes findings, and emails them; the send log's
// key (built from the report digest) is the only memory of what was said.

/** How far ahead the lint looks, in ET calendar days from today. */
export const HORIZON_DAYS = 28;

/**
 * Session types (see TAG_TO_TYPE in lib/momence-events.ts) that are the
 * recurring, stacked sessions a special event sits on top of. An overlap on
 * one of these is "cancel it"; an overlap on anything else (a guided
 * session, a yoga class) is "look at it", since it may be intentional.
 */
export const PRESELECT_TYPES: readonly string[] = ['open hours', 'social'];

export type FindingKind =
  | 'special-event-overlap'
  | 'untagged'
  | 'draft-soon'
  | 'duplicate'
  | 'capacity-outlier'
  | 'horizon-short';

/**
 * cancel — take it off the calendar (a regular slot under a special event)
 * fix    — something is wrong with the session itself
 * notice — worth a look, probably fine
 */
export type Severity = 'cancel' | 'fix' | 'notice';

/** A session as the lint reports it. */
export interface SessionRef {
  id: number;
  title: string;
  /** Canonical type from sessionTypeForTags(): 'open hours', 'social', 'guided', ..., 'general'. */
  type: string;
  /** ISO 8601 UTC. */
  startsAt: string;
  endsAt: string;
  location: string | null;
  /** Seats taken, when the feed lets us tell; null when it doesn't. */
  bookingCount: number | null;
  capacity: number | null;
  /** Momence's public page for the session, when the feed carries one. */
  link: string | null;
}

export interface Finding {
  rule: FindingKind;
  severity: Severity;
  /**
   * Stable across runs for the same underlying problem — the digest is built
   * from these, so a key that changes on every run would email on every run.
   */
  key: string;
  /** The session the finding is about; null for schedule-wide findings. */
  session: SessionRef | null;
  /** The other party: the special event, or the duplicate that is kept. */
  context?: SessionRef;
  /** One line the email prints as-is. */
  message: string;
}

export interface LintReport {
  /** ET calendar dates. */
  horizonStart: string;
  horizonEnd: string;
  findings: Finding[];
  /** Short hash of the sorted finding keys; the send key's identity. */
  digest: string;
}
