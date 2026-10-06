// Shared vocabulary for the staff scheduling feature (see
// docs/staff-scheduling-scope.md). Mirrors the check constraints in the
// staff_scheduling migration.

export const TIME_OFF_KINDS = ['range', 'recurring'] as const;
export type TimeOffKind = (typeof TIME_OFF_KINDS)[number];

/** Index = JS Date.getDay(): 0 = Sunday .. 6 = Saturday. */
export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Window names the sheet used; the label field stays free text for ad-hoc shifts. */
export const SHIFT_LABEL_SUGGESTIONS = [
  'Morning',
  'Day',
  'Afternoon',
  'Evening',
  'Maintenance',
] as const;

/**
 * How far back the board's Requests view (and its badge count) reaches for
 * pending hours changes. Staying late is asked about after the fact, so these
 * sit on past shifts — but not indefinitely: older asks fall off the queue.
 */
export const HOURS_CHANGE_LOOKBACK_DAYS = 35;

/**
 * How badly someone needs time off (time_off.severity, sub_requests.severity
 * — mirrors their check constraints). Optional everywhere; null = not given.
 */
export const TIME_OFF_SEVERITIES = ['low', 'medium', 'high'] as const;
export type TimeOffSeverity = (typeof TIME_OFF_SEVERITIES)[number];

export const TIME_OFF_SEVERITY_LABELS: Record<TimeOffSeverity, string> = {
  low: 'Flexible',
  medium: 'Needed',
  high: 'Emergency',
};

/** What each level means, for pickers and tooltips. */
export const TIME_OFF_SEVERITY_HINTS: Record<TimeOffSeverity, string> = {
  low: 'Would prefer it off — can still work it if nobody covers',
  medium: 'Needs it off — plans or commitments',
  high: "Can't work it — illness or emergency",
};

export function isTimeOffSeverity(value: unknown): value is TimeOffSeverity {
  return typeof value === 'string' && (TIME_OFF_SEVERITIES as readonly string[]).includes(value);
}
