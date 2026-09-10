// Shared shapes for the schedule lint: what one rule reports, what the whole
// run reports, how a rule is configured, and the constants the rules, the
// job, the email, the admin page, and the webhook trigger all agree on.
//
// Momence is the source of truth for the schedule. The only thing stored is
// the rule configuration (schedule_lint_rules); findings are computed fresh
// each run, and the send log's key (built from the report digest) is the
// only memory of what was said.

/** How far ahead the lint looks, in ET calendar days from today. */
export const HORIZON_DAYS = 28;

/**
 * Session types (see TAG_TO_TYPE in lib/momence-events.ts) that are the
 * recurring, stacked sessions a special event sits on top of. The default
 * for the overlap rule's "cancel these" list and the horizon rule's "regular
 * schedule" list; both are editable on /admin/schedule-lint.
 */
export const PRESELECT_TYPES: readonly string[] = ['open hours', 'social'];

/** The admin page where rules are viewed, tuned, added, and previewed. */
export const SCHEDULE_LINT_PAGE = '/admin/schedule-lint';

/** Rules that ship with the app: always present, can be disabled or tuned. */
export type BuiltInKind =
  | 'special-event-overlap'
  | 'untagged'
  | 'draft-soon'
  | 'duplicate'
  | 'capacity-outlier'
  | 'horizon-short';

/** Rule templates an admin can add as many of as they like, each with its own settings. */
export type CustomKind =
  | 'opening-hours'
  | 'required-tag'
  | 'expected-capacity'
  | 'duration-variants';

export type RuleKind = BuiltInKind | CustomKind;

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
  rule: RuleKind;
  /** The rule instance: the kind for built-ins, the row id for custom rules. */
  ruleId: string;
  ruleLabel: string;
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

// --- Rule configuration -----------------------------------------------------

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/** "HH:MM" 24h wall-clock, America/New_York. */
export interface DayWindow {
  open: string;
  close: string;
}

/** null = closed that day. */
export type OpeningHours = Record<DayKey, DayWindow | null>;

/**
 * One editable setting on a rule, as the admin form renders it:
 *   number         — an integer within [min, max]
 *   text           — a short string
 *   boolean        — a checkbox
 *   type           — one session type
 *   types          — a set of session types (empty allowed)
 *   durations      — one or more lengths in minutes, each within [min, max]
 *   opening-hours  — a week of open/close windows
 */
export type ParamFieldType =
  | 'number'
  | 'text'
  | 'boolean'
  | 'type'
  | 'types'
  | 'durations'
  | 'opening-hours';

export interface ParamField {
  key: string;
  label: string;
  type: ParamFieldType;
  hint?: string;
  /** Numbers, and every entry of a `durations` list. */
  min?: number;
  max?: number;
  /** Text fields: may be left blank. */
  optional?: boolean;
}

/** A rule as configured: what the job runs and what the page lists. */
export interface RuleInstance {
  /** The kind for built-ins, a uuid for custom rules. */
  id: string;
  kind: RuleKind;
  label: string;
  enabled: boolean;
  params: Record<string, unknown>;
  builtIn: boolean;
}
