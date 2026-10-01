// The on-call rule: a founder working that day takes the call, otherwise the
// free founders split it evenly. Hand-picked shifts and history are never
// rewritten but do count toward the split.

import { describe, expect, it } from "vitest";
import {
	type OnCallPerson,
	type OnCallShift,
	onCallPeople,
	planOnCall,
	workingOnCall,
} from "../src/on-call";
import type { TimeOffRow } from "../src/types";

const people: OnCallPerson[] = [
	{ id: "wes", display_name: "Wes", active: true, on_call_eligible: true },
	{ id: "julien", display_name: "Julien", active: true, on_call_eligible: true },
	{ id: "sunny", display_name: "Sunny", active: true, on_call_eligible: false },
	{ id: "old", display_name: "Old", active: false, on_call_eligible: true },
];

let seq = 0;
function shift(
	date: string,
	crew: string[] = [],
	extra: Partial<OnCallShift> = {},
): OnCallShift {
	seq += 1;
	return {
		id: `s${String(seq).padStart(3, "0")}`,
		shift_date: date,
		starts_at: "09:00:00",
		ends_at: "13:00:00",
		status: "active",
		is_draft: false,
		on_call_staff_id: null,
		on_call_manual: false,
		assignments: crew.map((staff_id) => ({ staff_id, is_draft: false })),
		...extra,
	};
}

function timeOff(staffId: string, date: string, extra: Partial<TimeOffRow> = {}): TimeOffRow {
	return {
		id: `to-${staffId}-${date}`,
		staff_id: staffId,
		kind: "range",
		start_date: date,
		end_date: date,
		days_of_week: [],
		starts_at: null,
		ends_at: null,
		note: null,
		created_by: "admin",
		created_at: "",
		updated_at: "",
		...extra,
	};
}

/** shiftId → who the plan leaves on call (unchanged shifts keep theirs). */
function outcome(shifts: OnCallShift[], timeOffRows: TimeOffRow[] = [], fromDate = "2026-10-05") {
	const changes = planOnCall({ shifts, people, timeOff: timeOffRows, fromDate });
	const byId = new Map(changes.map((c) => [c.shiftId, c.to]));
	return Object.fromEntries(
		shifts.map((s) => [s.id, byId.has(s.id) ? byId.get(s.id) : s.on_call_staff_id]),
	);
}

describe("onCallPeople", () => {
	it("keeps active, flagged people, ordered by name", () => {
		expect(onCallPeople(people).map((p) => p.id)).toEqual(["julien", "wes"]);
	});
});

describe("planOnCall", () => {
	it("puts the founder on the shift on call", () => {
		const s = shift("2026-10-05", ["sunny", "wes"]);
		expect(outcome([s])[s.id]).toBe("wes");
	});

	it("covers every shift that day with a founder working another one", () => {
		const morning = shift("2026-10-05", ["julien"]);
		const evening = shift("2026-10-05", ["sunny"], { starts_at: "17:00:00", ends_at: "21:00:00" });
		const result = outcome([morning, evening]);
		expect(result[morning.id]).toBe("julien");
		expect(result[evening.id]).toBe("julien");
	});

	it("prefers the founder on this shift over one working elsewhere that day", () => {
		const morning = shift("2026-10-05", ["julien"]);
		const evening = shift("2026-10-05", ["wes"], { starts_at: "17:00:00", ends_at: "21:00:00" });
		const result = outcome([morning, evening]);
		expect(result[morning.id]).toBe("julien");
		expect(result[evening.id]).toBe("wes");
	});

	it("splits days neither founder works evenly", () => {
		const shifts = ["05", "06", "07", "08"].map((d) => shift(`2026-10-${d}`, ["sunny"]));
		const counts: Record<string, number> = {};
		for (const id of Object.values(outcome(shifts))) counts[id as string] = (counts[id as string] ?? 0) + 1;
		expect(counts).toEqual({ julien: 2, wes: 2 });
	});

	it("doesn't count working days against the split", () => {
		// Wes works Mon–Wed; Thu and Fri are off-days for both and split 1/1.
		const shifts = [
			shift("2026-10-05", ["wes"]),
			shift("2026-10-06", ["wes"]),
			shift("2026-10-07", ["wes"]),
			shift("2026-10-08", ["sunny"]),
			shift("2026-10-09", ["sunny"]),
		];
		const result = outcome(shifts);
		expect([result[shifts[3].id], result[shifts[4].id]].sort()).toEqual(["julien", "wes"]);
	});

	it("skips a founder on time off", () => {
		const shifts = ["05", "06"].map((d) => shift(`2026-10-${d}`, ["sunny"]));
		const result = outcome(shifts, [timeOff("julien", "2026-10-05"), timeOff("julien", "2026-10-06")]);
		expect(result[shifts[0].id]).toBe("wes");
		expect(result[shifts[1].id]).toBe("wes");
	});

	it("prefers whole-shift availability over partial", () => {
		const s = shift("2026-10-05", ["sunny"]);
		const result = outcome(
			[s],
			[timeOff("julien", "2026-10-05", { starts_at: "08:00:00", ends_at: "10:00:00" })],
		);
		expect(result[s.id]).toBe("wes");
	});

	it("falls back to partly-available, then to nobody", () => {
		const partial = shift("2026-10-05", ["sunny"]);
		const none = shift("2026-10-06", ["sunny"], { on_call_staff_id: "wes" });
		const changes = planOnCall({
			shifts: [partial, none],
			people,
			timeOff: [
				timeOff("julien", "2026-10-05", { starts_at: "08:00:00", ends_at: "10:00:00" }),
				timeOff("wes", "2026-10-05"),
				timeOff("julien", "2026-10-06"),
				timeOff("wes", "2026-10-06"),
			],
			fromDate: "2026-10-05",
		});
		expect(changes).toEqual([
			{ shiftId: partial.id, from: null, to: "julien", reason: "split" },
			{ shiftId: none.id, from: "wes", to: null, reason: "nobody_free" },
		]);
	});

	it("leaves hand-picked shifts alone but counts them", () => {
		const pinned = shift("2026-10-05", ["sunny"], { on_call_staff_id: "julien", on_call_manual: true });
		const next = shift("2026-10-06", ["sunny"]);
		const changes = planOnCall({ shifts: [pinned, next], people, timeOff: [], fromDate: "2026-10-05" });
		expect(changes).toEqual([{ shiftId: next.id, from: null, to: "wes", reason: "split" }]);
	});

	it("leaves history alone but carries its split forward", () => {
		const past = [
			shift("2026-09-28", ["sunny"], { on_call_staff_id: "julien" }),
			shift("2026-09-29", ["sunny"], { on_call_staff_id: "julien" }),
			shift("2026-09-30", ["sunny"], { on_call_staff_id: "wes" }),
		];
		const next = shift("2026-10-05", ["sunny"]);
		const changes = planOnCall({ shifts: [...past, next], people, timeOff: [], fromDate: "2026-10-05" });
		expect(changes).toEqual([{ shiftId: next.id, from: null, to: "wes", reason: "split" }]);
	});

	it("keeps the current holder on a tie, so a re-run is a no-op", () => {
		const shifts = [
			shift("2026-10-05", ["sunny"], { on_call_staff_id: "wes" }),
			shift("2026-10-06", ["sunny"], { on_call_staff_id: "julien" }),
		];
		expect(planOnCall({ shifts, people, timeOff: [], fromDate: "2026-10-05" })).toEqual([]);
	});

	it("ignores drafts, cancelled shifts, and draft assignments", () => {
		const cancelled = shift("2026-10-05", ["wes"], { status: "cancelled" });
		const draft = shift("2026-10-05", ["wes"], { is_draft: true });
		const live = shift("2026-10-05", [], {});
		live.assignments = [{ staff_id: "julien", is_draft: true }];
		const changes = planOnCall({ shifts: [cancelled, draft, live], people, timeOff: [], fromDate: "2026-10-05" });
		expect(changes.map((c) => c.shiftId)).toEqual([live.id]);
		// Neither founder is live-working that day, so it's a plain split.
		expect(changes[0].reason).toBe("split");
	});

	it("never names someone who isn't flagged or active", () => {
		const s = shift("2026-10-05", ["sunny", "old"]);
		expect(["julien", "wes"]).toContain(outcome([s])[s.id]);
	});
});

describe("workingOnCall", () => {
	it("splits the founders on this shift from those elsewhere that day", () => {
		const a = shift("2026-10-05", ["wes", "sunny"]);
		const b = shift("2026-10-05", ["julien"]);
		const ids = new Set(["wes", "julien"]);
		expect(workingOnCall(a, [a, b], ids)).toEqual({ onShift: ["wes"], onDay: ["julien"] });
	});
});
