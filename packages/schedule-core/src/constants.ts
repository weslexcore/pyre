// Shared vocabulary for the staff scheduling feature (see
// docs/staff-scheduling-scope.md). Mirrors the check constraints in the
// staff_scheduling migration.

export const ASSIGNMENT_ROLES = ['full', 'setup', 'partial'] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export const ASSIGNMENT_ROLE_LABELS: Record<AssignmentRole, string> = {
  full: 'Full',
  setup: 'Setup',
  partial: 'Partial',
};

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
