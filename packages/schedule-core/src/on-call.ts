// On-call rule: every live shift names one person the crew rings when
// something goes wrong. Who may be on call is a roster flag
// (StaffRow.on_call_eligible — the founders today, maybe shift leads later).
//
//   1. Someone on call who is working that day takes it — whoever is on this
//      very shift first, then whoever works another shift that day.
//   2. Otherwise it's split evenly between the on-call people who are free
//      (no time off) for the shift's hours.
//
// "Evenly" counts only the shifts covered under rule 2 — a founder working a
// long week isn't owed fewer off-day calls for it — and reaches back over the
// shifts passed in before `fromDate` (the API sends ON_CALL_LOOKBACK_DAYS of
// history) so the split carries across weeks instead of resetting every
// Monday. Hand-picked shifts (on_call_manual) and history are never changed,
// but both count toward the split.
//
// Pure, like the rest of schedule-core: the API runs it to fill the board, and
// the board reads workingOnCall() to flag a shift whose on-call has drifted
// from rule 1 since it was filled.

import { availabilityFor, timeToMinutes } from "./availability";
import type { ShiftAssignmentRow, ShiftRow, StaffRow, TimeOffRow } from "./types";

/** How far back the even split looks when balancing a new fill. */
export const ON_CALL_LOOKBACK_DAYS = 28;

export type OnCallPerson = Pick<
	StaffRow,
	"id" | "display_name" | "active" | "on_call_eligible"
>;

export type OnCallShift = Pick<
	ShiftRow,
	| "id"
	| "shift_date"
	| "starts_at"
	| "ends_at"
	| "status"
	| "is_draft"
	| "on_call_staff_id"
	| "on_call_manual"
> & {
	assignments: ReadonlyArray<Pick<ShiftAssignmentRow, "staff_id" | "is_draft">>;
};

/** Why the planner chose who it chose. */
export type OnCallReason =
	/** On call and on this shift. */
	| "on_shift"
	/** On call and working another shift that day. */
	| "working_day"
	/** Nobody on call works that day; the free person with the fewest. */
	| "split"
	/** Nobody on call is free for the shift. */
	| "nobody_free";

export interface OnCallChange {
	shiftId: string;
	from: string | null;
	to: string | null;
	reason: OnCallReason;
}

/** People who may be on call: flagged and still on the roster, by name. */
export function onCallPeople<P extends OnCallPerson>(
	people: readonly P[],
): P[] {
	return people
		.filter((p) => p.active && p.on_call_eligible)
		.sort((a, b) => a.display_name.localeCompare(b.display_name));
}

function isLive(shift: Pick<ShiftRow, "status" | "is_draft">): boolean {
	return shift.status === "active" && !shift.is_draft;
}

/** Staff ids with a live assignment on a live shift, per date. */
function workingByDate(shifts: readonly OnCallShift[]): Map<string, Set<string>> {
	const byDate = new Map<string, Set<string>>();
	for (const shift of shifts) {
		if (!isLive(shift)) continue;
		const set = byDate.get(shift.shift_date) ?? new Set<string>();
		for (const a of shift.assignments) if (!a.is_draft) set.add(a.staff_id);
		byDate.set(shift.shift_date, set);
	}
	return byDate;
}

/**
 * Rule 1 for one shift: the on-call people on it, and the ones working
 * another shift that day. `dayShifts` is every shift on the shift's date.
 */
export function workingOnCall(
	shift: OnCallShift,
	dayShifts: readonly OnCallShift[],
	eligibleIds: ReadonlySet<string>,
): { onShift: string[]; onDay: string[] } {
	const onShift = isLive(shift)
		? shift.assignments
				.filter((a) => !a.is_draft && eligibleIds.has(a.staff_id))
				.map((a) => a.staff_id)
		: [];
	const working = workingByDate(dayShifts).get(shift.shift_date) ?? new Set();
	const onDay = [...working].filter(
		(id) => eligibleIds.has(id) && !onShift.includes(id),
	);
	return { onShift: [...new Set(onShift)], onDay };
}

/**
 * Fill on-call for every live, not-hand-picked shift dated `fromDate` or
 * later. Returns only the shifts whose on-call person would change.
 *
 * `shifts` should hold whole days (rule 1 looks across the day) plus any
 * history the split should count — shifts before `fromDate` are read, never
 * changed.
 */
export function planOnCall(input: {
	shifts: readonly OnCallShift[];
	people: readonly OnCallPerson[];
	timeOff: readonly TimeOffRow[];
	fromDate: string;
}): OnCallChange[] {
	const eligible = onCallPeople(input.people);
	const eligibleIds = new Set(eligible.map((p) => p.id));
	const working = workingByDate(input.shifts);

	const ordered = [...input.shifts].sort(
		(a, b) =>
			a.shift_date.localeCompare(b.shift_date) ||
			a.starts_at.localeCompare(b.starts_at) ||
			a.id.localeCompare(b.id),
	);

	// Rule-2 calls each person already carries: history and hand-picked shifts
	// where the on-call person wasn't working that day.
	const splitCount = new Map<string, number>(eligible.map((p) => [p.id, 0]));
	const countSplit = (shift: OnCallShift, staffId: string | null) => {
		if (!staffId || !splitCount.has(staffId)) return;
		if (working.get(shift.shift_date)?.has(staffId)) return;
		splitCount.set(staffId, (splitCount.get(staffId) ?? 0) + 1);
	};
	const targets: OnCallShift[] = [];
	for (const shift of ordered) {
		if (!isLive(shift)) continue;
		if (shift.shift_date < input.fromDate || shift.on_call_manual) {
			countSplit(shift, shift.on_call_staff_id);
		} else {
			targets.push(shift);
		}
	}

	// Fewest calls wins; a tie keeps whoever already holds the shift (so a
	// re-run doesn't reshuffle a settled week), then goes by name.
	const pick = (pool: readonly string[], current: string | null): string => {
		const least = Math.min(...pool.map((id) => splitCount.get(id) ?? 0));
		const tied = pool.filter((id) => (splitCount.get(id) ?? 0) === least);
		return current && tied.includes(current) ? current : tied[0];
	};
	const byName = (ids: Iterable<string>) => {
		const set = new Set(ids);
		return eligible.filter((p) => set.has(p.id)).map((p) => p.id);
	};

	const changes: OnCallChange[] = [];
	for (const shift of targets) {
		const day = working.get(shift.shift_date) ?? new Set<string>();
		const onShift = byName(
			shift.assignments.filter((a) => !a.is_draft).map((a) => a.staff_id),
		);
		const onDay = byName(day);

		let to: string | null;
		let reason: OnCallReason;
		if (onShift.length > 0) {
			to = pick(onShift, shift.on_call_staff_id);
			reason = "on_shift";
		} else if (onDay.length > 0) {
			to = pick(onDay, shift.on_call_staff_id);
			reason = "working_day";
		} else {
			const start = timeToMinutes(shift.starts_at);
			const end = timeToMinutes(shift.ends_at);
			const status = (id: string) =>
				availabilityFor(
					input.timeOff as TimeOffRow[],
					id,
					shift.shift_date,
					start,
					end,
				).status;
			// Free for the whole shift first; someone off for part of it beats
			// nobody at all.
			const free = eligible.filter((p) => status(p.id) === "free");
			const partial = eligible.filter((p) => status(p.id) === "partial");
			const pool = (free.length > 0 ? free : partial).map((p) => p.id);
			if (pool.length > 0) {
				to = pick(pool, shift.on_call_staff_id);
				reason = "split";
				splitCount.set(to, (splitCount.get(to) ?? 0) + 1);
			} else {
				to = null;
				reason = "nobody_free";
			}
		}

		if (to !== shift.on_call_staff_id) {
			changes.push({ shiftId: shift.id, from: shift.on_call_staff_id, to, reason });
		}
	}
	return changes;
}
