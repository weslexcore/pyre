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

/**
 * The Setup role's span from the shift-window start. Windows are derived
 * with a 90min lead before the first session (leadMin in windows.ts), so
 * window start + 2h = 30min after sessions begin — the setup handoff point.
 * Shared by the board's role snapping and the shift-request approval path.
 */
export const SETUP_DURATION_MIN = 120;

// --- Duties: which jobs a person holds within their hours ---
//
// Orthogonal to AssignmentRole (which is the hours). The vocabulary matches
// the SOP library so each duty deep-links to the doc defining it, and it
// groups into the three phases of a shift: set up, work the session, break
// down. Mirrors the check constraint in the shift_assignment_duties migration.

export const ASSIGNMENT_DUTIES = [
  'setup',
  'host',
  'customer_care',
  'breakdown',
  'breakdown_a',
  'breakdown_b',
] as const;
export type AssignmentDuty = (typeof ASSIGNMENT_DUTIES)[number];

export const ASSIGNMENT_DUTY_LABELS: Record<AssignmentDuty, string> = {
  setup: 'Setup',
  host: 'Host',
  customer_care: 'Customer Care',
  breakdown: 'Break Down',
  breakdown_a: 'Break Down (A)',
  breakdown_b: 'Break Down (B)',
};

/** Slug of the SOP that defines each duty — /admin/sops/{slug}. */
export const ASSIGNMENT_DUTY_SOPS: Record<AssignmentDuty, string> = {
  setup: 'full-setup',
  host: 'host-responsibilities',
  customer_care: 'customer-care-responsibilities',
  breakdown: 'break-down',
  breakdown_a: 'break-down-a-fire-and-water',
  breakdown_b: 'break-down-b-guest-areas',
};

/**
 * The three phases of a shift, in the order they happen. Drives the duty
 * picker's grouping and the canonical display order of a duties array.
 */
export const DUTY_PHASES = [
  { key: 'setup', label: 'Setup', duties: ['setup'] },
  { key: 'session', label: 'In session', duties: ['host', 'customer_care'] },
  { key: 'breakdown', label: 'Breakdown', duties: ['breakdown', 'breakdown_a', 'breakdown_b'] },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  duties: readonly AssignmentDuty[];
}>;

export type DutyPhaseKey = (typeof DUTY_PHASES)[number]['key'];

/**
 * Drop unknown values and duplicates, then order by ASSIGNMENT_DUTIES so a
 * person's duties always read setup -> session -> breakdown however they were
 * clicked or drafted. Used by the API on write and the boards on display.
 */
export function normalizeDuties(duties: readonly string[]): AssignmentDuty[] {
  const kept = new Set<AssignmentDuty>();
  for (const duty of duties) {
    if ((ASSIGNMENT_DUTIES as readonly string[]).includes(duty)) kept.add(duty as AssignmentDuty);
  }
  return ASSIGNMENT_DUTIES.filter((d) => kept.has(d));
}

/** "Setup · Host · Break Down (A)", or null when nobody assigned any. */
export function formatDuties(duties: readonly string[]): string | null {
  const normalized = normalizeDuties(duties);
  return normalized.length > 0 ? normalized.map((d) => ASSIGNMENT_DUTY_LABELS[d]).join(' · ') : null;
}
