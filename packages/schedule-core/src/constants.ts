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
