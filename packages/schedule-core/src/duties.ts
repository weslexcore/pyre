// --- Duties: which jobs a person holds within their hours ---
//
// Independent of the hours (starts_at / ends_at). Each duty deep-links to
// the SOP that defines it, and belongs to one of the three phases of a shift:
// set up, work the session, break down. Set-up and break-down duties can be
// split into an (A) and a (B) side, one per person, and a person keeps their
// letter across both phases; a solo shift holds both.
//
// The list itself is admin-configurable — rows in public.shift_duties, edited
// at /admin/schedule/duties — so every helper here takes the catalog rather
// than reading a constant. Keys are permanent (they're what the duties[]
// arrays store); labels, SOP links, order and sides are free to change.
// DEFAULT_DUTY_CATALOG mirrors the rows the shift_duties migration seeds.

export const DUTY_PHASE_KEYS = ["setup", "session", "breakdown"] as const;
export type DutyPhaseKey = (typeof DUTY_PHASE_KEYS)[number];

export const DUTY_PHASE_LABELS: Record<DutyPhaseKey, string> = {
	setup: "Setup",
	session: "In session",
	breakdown: "Breakdown",
};

export const DUTY_SIDES = ["a", "b"] as const;
export type DutySide = (typeof DUTY_SIDES)[number];

/** A duty key as stored on shift_assignments.duties — see DutyDef.key. */
export type AssignmentDuty = string;

export interface DutyDef {
	/** Permanent machine key stored in the duties[] arrays ("setup_a"). */
	key: string;
	/** "Set Up (A)". */
	label: string;
	/** What the duty actually covers ("Fire + Water"); null when the label says it all. */
	detail: string | null;
	phase: DutyPhaseKey;
	/**
	 * The half of a split set-up / break-down this is. Whoever takes a side at
	 * set-up takes the same side at break down; null for an unsplit duty.
	 */
	side: DutySide | null;
	/** The in-session duty taking this half usually implies ("customer_care"). */
	sessionDefault: string | null;
	/** Slug of the SOP that defines it — /admin/sops/{slug}; null if unlinked. */
	sopSlug: string | null;
	sortOrder: number;
	/** Retired: no longer offered, but still readable on old assignments. */
	archived: boolean;
}

export type DutyCatalog = readonly DutyDef[];

/** public.shift_duties as selected, with the linked SOP's slug joined on. */
export interface ShiftDutyRow {
	key: string;
	label: string;
	detail: string | null;
	phase: DutyPhaseKey;
	side: DutySide | null;
	session_default: string | null;
	sop_id: string | null;
	sort_order: number;
	archived: boolean;
}

export function dutyDefFromRow(
	row: ShiftDutyRow,
	sopSlug: string | null,
): DutyDef {
	return {
		key: row.key,
		label: row.label,
		detail: row.detail,
		phase: row.phase,
		side: row.side,
		sessionDefault: row.session_default,
		sopSlug,
		sortOrder: row.sort_order,
		archived: row.archived,
	};
}

/**
 * The six duties the schedule shipped with. The migration seeds the same
 * rows; this copy is the fallback when the table can't be read, and the
 * fixture the tests run against.
 */
export const DEFAULT_DUTY_CATALOG: DutyCatalog = [
	{
		key: "setup_a",
		label: "Set Up (A)",
		detail: "Fire + Water",
		phase: "setup",
		side: "a",
		sessionDefault: "customer_care",
		sopSlug: "set-up-a-fire-and-water",
		sortOrder: 0,
		archived: false,
	},
	{
		key: "setup_b",
		label: "Set Up (B)",
		detail: "Space Prep",
		phase: "setup",
		side: "b",
		sessionDefault: "host",
		sopSlug: "set-up-b-space-prep",
		sortOrder: 1,
		archived: false,
	},
	{
		key: "host",
		label: "Host",
		detail: null,
		phase: "session",
		side: null,
		sessionDefault: null,
		sopSlug: "host-responsibilities",
		sortOrder: 2,
		archived: false,
	},
	{
		key: "customer_care",
		label: "Customer Care",
		detail: null,
		phase: "session",
		side: null,
		sessionDefault: null,
		sopSlug: "customer-care-responsibilities",
		sortOrder: 3,
		archived: false,
	},
	{
		key: "breakdown_a",
		label: "Break Down (A)",
		detail: "Fire + Water",
		phase: "breakdown",
		side: "a",
		sessionDefault: "customer_care",
		sopSlug: "break-down-a-fire-and-water",
		sortOrder: 4,
		archived: false,
	},
	{
		key: "breakdown_b",
		label: "Break Down (B)",
		detail: "Guest Areas",
		phase: "breakdown",
		side: "b",
		sessionDefault: "host",
		sopSlug: "break-down-b-guest-areas",
		sortOrder: 5,
		archived: false,
	},
];

/** Canonical order: phase (set up -> session -> break down), then sort order. */
export function sortCatalog(catalog: DutyCatalog): DutyDef[] {
	const phaseIndex = (d: DutyDef) => DUTY_PHASE_KEYS.indexOf(d.phase);
	return [...catalog].sort(
		(a, b) =>
			phaseIndex(a) - phaseIndex(b) ||
			a.sortOrder - b.sortOrder ||
			a.key.localeCompare(b.key),
	);
}

export function dutyDef(
	catalog: DutyCatalog,
	key: string,
): DutyDef | undefined {
	return catalog.find((d) => d.key === key);
}

/** The label, or the raw key for a duty the catalog no longer knows. */
export function dutyLabel(catalog: DutyCatalog, key: string): string {
	return dutyDef(catalog, key)?.label ?? key;
}

/** "Set Up (A) — Fire + Water". */
export function dutyTitle(catalog: DutyCatalog, key: string): string {
	const def = dutyDef(catalog, key);
	if (!def) return key;
	return def.detail ? `${def.label} — ${def.detail}` : def.label;
}

/**
 * The picker's groups, in shift order. Archived duties are left out unless
 * asked for, so retiring one takes it off the board without touching the
 * assignments that already hold it. Empty phases are dropped.
 */
export function dutyPhases(
	catalog: DutyCatalog,
	opts: { includeArchived?: boolean } = {},
): Array<{ key: DutyPhaseKey; label: string; duties: DutyDef[] }> {
	const sorted = sortCatalog(catalog).filter(
		(d) => opts.includeArchived || !d.archived,
	);
	return DUTY_PHASE_KEYS.map((key) => ({
		key,
		label: DUTY_PHASE_LABELS[key],
		duties: sorted.filter((d) => d.phase === key),
	})).filter((phase) => phase.duties.length > 0);
}

const OTHER_SPLIT_PHASE: Partial<Record<DutyPhaseKey, DutyPhaseKey>> = {
	setup: "breakdown",
	breakdown: "setup",
};

/**
 * This duty's half in the other phase: whoever takes A at set-up takes A at
 * break down, so the person who lit the fire and balanced the water is the
 * one who puts that side to bed knowing its state. Null for an unsplit duty
 * or a side with no live counterpart. Advisory — the board pre-selects the
 * pair and flags a split, the API never rejects one.
 */
export function pairedDutyFor(
	catalog: DutyCatalog,
	key: string,
): string | null {
	const def = dutyDef(catalog, key);
	const otherPhase = def?.side ? OTHER_SPLIT_PHASE[def.phase] : undefined;
	if (!def || !otherPhase) return null;
	const pair = sortCatalog(catalog).find(
		(d) => !d.archived && d.phase === otherPhase && d.side === def.side,
	);
	return pair?.key ?? null;
}

/**
 * Drop unknown values and duplicates, then order by the catalog so a
 * person's duties always read set up -> session -> break down however they
 * were clicked or drafted. Archived duties are kept: they're still true of
 * the shift they were assigned on. Used by the API on write and the boards
 * on display.
 */
export function normalizeDuties(
	catalog: DutyCatalog,
	duties: readonly string[],
): string[] {
	const held = new Set(duties);
	return sortCatalog(catalog)
		.filter((d) => held.has(d.key))
		.map((d) => d.key);
}

/**
 * Add or remove `key`, filling in what taking a half usually implies: the
 * matching half in the other phase, and that side's in-session duty. One
 * click instead of three for the common case.
 *
 * Nothing is ever auto-removed, so every part of the mix stays an admin's to
 * change — drop the in-session duty and pick the other one, split the
 * letters, or (working a shift alone) hold every half at once.
 */
export function toggleDuty(
	catalog: DutyCatalog,
	duties: readonly string[],
	key: string,
): string[] {
	const held = new Set(normalizeDuties(catalog, duties));
	if (held.has(key)) {
		held.delete(key);
		return normalizeDuties(catalog, [...held]);
	}
	held.add(key);
	const pair = pairedDutyFor(catalog, key);
	if (pair) held.add(pair);
	const inSession = dutyDef(catalog, key)?.sessionDefault;
	const inSessionDef = inSession ? dutyDef(catalog, inSession) : undefined;
	if (inSessionDef && !inSessionDef.archived) held.add(inSessionDef.key);
	return normalizeDuties(catalog, [...held]);
}

/**
 * Halves this person holds under different letters (Set Up (A) with Break
 * Down (B)) — the pairing rule broken, as [set-up half, break-down half]
 * pairs. Someone holding both sides of a phase is working it alone rather
 * than paired, so they are never a mismatch.
 */
export function mismatchedDutyPairs(
	catalog: DutyCatalog,
	duties: readonly string[],
): Array<[string, string]> {
	const held = normalizeDuties(catalog, duties)
		.map((key) => dutyDef(catalog, key) as DutyDef)
		.filter((d) => d.side !== null);
	const setup = held.filter((d) => d.phase === "setup");
	const breakdown = held.filter((d) => d.phase === "breakdown");
	const solo = (halves: DutyDef[]) =>
		new Set(halves.map((d) => d.side)).size > 1;
	if (solo(setup) || solo(breakdown)) return [];
	const pairs: Array<[string, string]> = [];
	for (const s of setup) {
		for (const b of breakdown) {
			if (s.side !== b.side) pairs.push([s.key, b.key]);
		}
	}
	return pairs;
}

/** "Set Up (A) · Host · Break Down (B)", or null when nobody assigned any. */
export function formatDuties(
	catalog: DutyCatalog,
	duties: readonly string[],
): string | null {
	const normalized = normalizeDuties(catalog, duties);
	return normalized.length > 0
		? normalized.map((key) => dutyLabel(catalog, key)).join(" · ")
		: null;
}
