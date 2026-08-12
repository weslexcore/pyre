// Shift-lead coverage rule: every staffed shift needs at least one person who
// can anchor it — a founder or someone flagged is_shift_lead on the roster.
// Advisory like the availability engine: the boards flag violations, the API
// never blocks them.

import type { ShiftAssignmentRow, StaffRow } from "./types";

/** Whether this person may anchor a shift on their own. */
export function canLeadShift(
	person: Pick<StaffRow, "is_founder" | "is_shift_lead">,
): boolean {
	return person.is_founder || person.is_shift_lead;
}

/**
 * True when the shift's live crew breaks the lead rule: someone is on it, but
 * nobody on it can anchor. Draft (unapproved) assignments don't count — they
 * aren't coverage yet. An empty shift is not "missing a lead"; it's just
 * uncovered, which the coverage tones already show.
 */
export function missingShiftLead(
	assignments: ReadonlyArray<Pick<ShiftAssignmentRow, "staff_id" | "is_draft">>,
	staffById: ReadonlyMap<
		string,
		Pick<StaffRow, "is_founder" | "is_shift_lead">
	>,
): boolean {
	const live = assignments.filter((a) => !a.is_draft);
	if (live.length === 0) return false;
	return !live.some((a) => {
		const person = staffById.get(a.staff_id);
		return person !== undefined && canLeadShift(person);
	});
}
