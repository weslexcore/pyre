// On-call rule: every day the venue runs names one person the crew rings when
// something goes wrong. Who may be on call is a roster flag
// (StaffRow.on_call_eligible — the founders today, maybe shift leads later).
//
// On-call is held for the whole day, not shift by shift. It is stored on each
// shift row (ShiftRow.on_call_staff_id) so the board and the agents can read
// it next to the shift, but every live shift on a date carries the same
// person — the rule writes the day's choice to all of them.
//
//   1. Someone on call who is working that day takes it.
//   2. Otherwise it's split evenly, a day at a time, between the on-call
//      people who are free (no time off) across the day's shift hours.
//
// "Evenly" counts only the days covered under rule 2 — a founder working a
// long week isn't owed fewer off-day calls for it — and reaches back over the
// shifts passed in before `fromDate` (the API sends ON_CALL_LOOKBACK_DAYS of
// history) so the split carries across weeks instead of resetting every
// Monday. A day picked by hand (any of its shifts on_call_manual) and history
// are never re-chosen, but both count toward the split.
//
// Pure, like the rest of schedule-core: the API runs it to fill the board, and
// the board reads workingOnCall() to flag a day whose on-call has drifted
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
	/** On call and working that day. */
	| "working_day"
	/** Another shift that day was picked by hand; this one follows it. */
	| "hand_picked"
	/** Nobody on call works that day; the free person with the fewest days. */
	| "split"
	/** Nobody on call is free for the day. */
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
 * Rule 1 for one day: the on-call people working any live shift in
 * `dayShifts` (every shift on that date).
 */
export function workingOnCall(
	dayShifts: readonly OnCallShift[],
	eligibleIds: ReadonlySet<string>,
): string[] {
	const working = new Set<string>();
	for (const set of workingByDate(dayShifts).values()) {
		for (const id of set) if (eligibleIds.has(id)) working.add(id);
	}
	return [...working];
}

/**
 * Fill on-call for every day dated `fromDate` or later that isn't picked by
 * hand, writing the day's choice to each of its live shifts. Returns only the
 * shifts whose on-call person would change.
 *
 * `shifts` should hold whole days plus any history the split should count —
 * shifts before `fromDate` are read, never changed.
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

	// Live shifts by date, each day in start order.
	const days = new Map<string, OnCallShift[]>();
	for (const shift of [...input.shifts].sort(
		(a, b) =>
			a.shift_date.localeCompare(b.shift_date) ||
			a.starts_at.localeCompare(b.starts_at) ||
			a.id.localeCompare(b.id),
	)) {
		if (!isLive(shift)) continue;
		const list = days.get(shift.shift_date) ?? [];
		list.push(shift);
		days.set(shift.shift_date, list);
	}

	// Rule-2 days each person already carries: history and hand-picked days
	// where the on-call person wasn't working.
	const splitCount = new Map<string, number>(eligible.map((p) => [p.id, 0]));
	const countSplit = (date: string, shifts: readonly OnCallShift[]) => {
		const holders = new Set(shifts.map((s) => s.on_call_staff_id));
		for (const staffId of holders) {
			if (!staffId || !splitCount.has(staffId)) continue;
			if (working.get(date)?.has(staffId)) continue;
			splitCount.set(staffId, (splitCount.get(staffId) ?? 0) + 1);
		}
	};

	// Fewest days wins; a tie keeps whoever already holds the day (so a re-run
	// doesn't reshuffle a settled week), then goes by name.
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
	for (const [date, shifts] of days) {
		if (date < input.fromDate) {
			countSplit(date, shifts);
			continue;
		}
		const manual = shifts.filter((s) => s.on_call_manual);
		const targets = shifts.filter((s) => !s.on_call_manual);

		let to: string | null;
		let reason: OnCallReason;
		if (manual.length > 0) {
			// The board picks a whole day at once; a shift added since follows
			// the pick.
			countSplit(date, manual);
			to = manual[0].on_call_staff_id;
			reason = "hand_picked";
		} else {
			const current = targets.find((s) => s.on_call_staff_id)?.on_call_staff_id ?? null;
			const onDay = byName(working.get(date) ?? []);
			if (onDay.length > 0) {
				to = current && onDay.includes(current) ? current : onDay[0];
				reason = "working_day";
			} else {
				// Free across the day's opening hours, first shift to last.
				const start = Math.min(...shifts.map((s) => timeToMinutes(s.starts_at)));
				const end = Math.max(...shifts.map((s) => timeToMinutes(s.ends_at)));
				const status = (id: string) =>
					availabilityFor(input.timeOff as TimeOffRow[], id, date, start, end).status;
				// Free for the whole day first; someone off for part of it beats
				// nobody at all.
				const free = eligible.filter((p) => status(p.id) === "free");
				const partial = eligible.filter((p) => status(p.id) === "partial");
				const pool = (free.length > 0 ? free : partial).map((p) => p.id);
				if (pool.length > 0) {
					to = pick(pool, current);
					reason = "split";
					splitCount.set(to, (splitCount.get(to) ?? 0) + 1);
				} else {
					to = null;
					reason = "nobody_free";
				}
			}
		}

		for (const shift of targets) {
			if (to !== shift.on_call_staff_id) {
				changes.push({ shiftId: shift.id, from: shift.on_call_staff_id, to, reason });
			}
		}
	}
	return changes;
}
