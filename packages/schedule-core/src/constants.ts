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
// down. Set-up and break-down are each split into an (A) and a (B) half, one
// per person, and a person keeps their letter across both phases; a solo
// shift holds both. Mirrors the check constraint in the setup_duty_halves
// migration.

export const ASSIGNMENT_DUTIES = [
  'setup_a',
  'setup_b',
  'host',
  'customer_care',
  'breakdown_a',
  'breakdown_b',
] as const;
export type AssignmentDuty = (typeof ASSIGNMENT_DUTIES)[number];

export const ASSIGNMENT_DUTY_LABELS: Record<AssignmentDuty, string> = {
  setup_a: 'Set Up (A)',
  setup_b: 'Set Up (B)',
  host: 'Host',
  customer_care: 'Customer Care',
  breakdown_a: 'Break Down (A)',
  breakdown_b: 'Break Down (B)',
};

/**
 * What each half actually covers — the SOP subtitles. Without these, "A" and
 * "B" are unguessable at the moment someone is assigning them.
 */
export const ASSIGNMENT_DUTY_DETAILS: Record<AssignmentDuty, string | null> = {
  setup_a: 'Fire + Water',
  setup_b: 'Space Prep',
  host: null,
  customer_care: null,
  breakdown_a: 'Fire + Water',
  breakdown_b: 'Guest Areas',
};

/** Slug of the SOP that defines each duty — /admin/sops/{slug}. */
export const ASSIGNMENT_DUTY_SOPS: Record<AssignmentDuty, string> = {
  setup_a: 'set-up-a-fire-and-water',
  setup_b: 'set-up-b-space-prep',
  host: 'host-responsibilities',
  customer_care: 'customer-care-responsibilities',
  breakdown_a: 'break-down-a-fire-and-water',
  breakdown_b: 'break-down-b-guest-areas',
};

/**
 * The three phases of a shift, in the order they happen. Drives the duty
 * picker's grouping and the canonical display order of a duties array.
 */
export const DUTY_PHASES = [
  { key: 'setup', label: 'Setup', duties: ['setup_a', 'setup_b'] },
  { key: 'session', label: 'In session', duties: ['host', 'customer_care'] },
  { key: 'breakdown', label: 'Breakdown', duties: ['breakdown_a', 'breakdown_b'] },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  duties: readonly AssignmentDuty[];
}>;

export type DutyPhaseKey = (typeof DUTY_PHASES)[number]['key'];

/**
 * The half someone holds in the other phase: whoever takes A at set-up takes A
 * at break down. Set Up (A) and Break Down (A) are both the fire-and-water
 * side, so keeping the letter means the person who lit the fire and balanced
 * the water is the one who puts that side to bed knowing its state. Advisory —
 * the board pre-selects the pair and flags a split, the API never rejects one.
 */
export const DUTY_PAIRS = {
  setup_a: 'breakdown_a',
  setup_b: 'breakdown_b',
  breakdown_a: 'setup_a',
  breakdown_b: 'setup_b',
} as const satisfies Partial<Record<AssignmentDuty, AssignmentDuty>>;

/**
 * The in-session duty each side falls to. A is fire and water — the saunas
 * and plunges the Customer Care SOP covers — and B is space prep and guest
 * areas, which is the Host's front of house. A default only: taking a half
 * fills this in, and an admin is free to change the mix afterwards.
 */
export const DUTY_SIDE_DEFAULTS = {
  setup_a: 'customer_care',
  breakdown_a: 'customer_care',
  setup_b: 'host',
  breakdown_b: 'host',
} as const satisfies Partial<Record<AssignmentDuty, AssignmentDuty>>;

/** The letters split across phases — Set Up (A) with Break Down (B). */
const DUTY_SPLIT_SIDES = {
  setup_a: 'breakdown_b',
  setup_b: 'breakdown_a',
} as const satisfies Partial<Record<AssignmentDuty, AssignmentDuty>>;

/** This duty's half in the other phase; null for host/customer care. */
export function pairedDutyFor(duty: AssignmentDuty): AssignmentDuty | null {
  return duty in DUTY_PAIRS ? DUTY_PAIRS[duty as keyof typeof DUTY_PAIRS] : null;
}

/**
 * Add or remove `duty`, filling in what taking a half usually implies: the
 * matching half in the other phase, and that side's in-session duty. One
 * click instead of three for the common case.
 *
 * Nothing is ever auto-removed, so every part of the mix stays an admin's to
 * change — drop the in-session duty and pick the other one, split the
 * letters, or (working a shift alone) hold every half at once.
 */
export function toggleDuty(duties: readonly string[], duty: AssignmentDuty): AssignmentDuty[] {
  const held = new Set(normalizeDuties(duties));
  if (held.has(duty)) {
    held.delete(duty);
    return normalizeDuties([...held]);
  }
  held.add(duty);
  const pair = pairedDutyFor(duty);
  if (pair) held.add(pair);
  const inSession = duty in DUTY_SIDE_DEFAULTS
    ? DUTY_SIDE_DEFAULTS[duty as keyof typeof DUTY_SIDE_DEFAULTS]
    : null;
  if (inSession) held.add(inSession);
  return normalizeDuties([...held]);
}

/**
 * Halves this person holds under different letters (Set Up (A) with Break
 * Down (B)) — the pairing rule broken, as [set-up half, break-down half]
 * pairs. Someone holding both halves of a phase is working it alone rather
 * than paired, so they are never a mismatch.
 */
export function mismatchedDutyPairs(
  duties: readonly string[]
): Array<[AssignmentDuty, AssignmentDuty]> {
  const held = new Set(normalizeDuties(duties));
  const soloSetup = held.has('setup_a') && held.has('setup_b');
  const soloBreakdown = held.has('breakdown_a') && held.has('breakdown_b');
  if (soloSetup || soloBreakdown) return [];
  return Object.entries(DUTY_SPLIT_SIDES)
    .filter(
      ([setup, breakdown]) =>
        held.has(setup as AssignmentDuty) && held.has(breakdown as AssignmentDuty)
    )
    .map(([setup, breakdown]) => [setup as AssignmentDuty, breakdown as AssignmentDuty]);
}

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

/** "Set Up (A) · Host · Break Down (B)", or null when nobody assigned any. */
export function formatDuties(duties: readonly string[]): string | null {
  const normalized = normalizeDuties(duties);
  return normalized.length > 0 ? normalized.map((d) => ASSIGNMENT_DUTY_LABELS[d]).join(' · ') : null;
}
