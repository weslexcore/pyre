// The duty vocabulary: an assignment's jobs (set up, work the session, break
// down), independent of the role that sets its hours. Two rules live here —
// normalising, because the stored array can neither dedupe nor order itself,
// and the pairing (whoever takes A at set-up takes A at break down). The list
// is admin-configurable, so the rules are driven by each duty's phase and
// side rather than by its key.

import { describe, expect, it } from "vitest";
import {
	DEFAULT_DUTY_CATALOG as C,
	type DutyCatalog,
	type DutyDef,
	dutyPhases,
	dutyRunsOn,
	dutyTitle,
	formatDuties,
	formatDutyDays,
	mismatchedDutyPairs,
	normalizeDuties,
	normalizeDutyDays,
	offDayDuties,
	pairedDutyFor,
	toggleDuty,
} from "../src/duties";

describe("normalizeDuties", () => {
	it("orders duties by phase however they were clicked", () => {
		expect(normalizeDuties(C, ["breakdown_b", "host", "setup_a"])).toEqual([
			"setup_a",
			"host",
			"breakdown_b",
		]);
	});

	it("drops duplicates and unknown values", () => {
		expect(normalizeDuties(C, ["host", "host", "setup", "sweeping"])).toEqual([
			"host",
		]);
	});

	it("keeps archived duties, which are still true of old shifts", () => {
		const archived = C.map((d) =>
			d.key === "host" ? { ...d, archived: true } : d,
		);
		expect(normalizeDuties(archived, ["host", "setup_a"])).toEqual([
			"setup_a",
			"host",
		]);
	});
});

describe("formatDuties", () => {
	it("joins the labels in phase order", () => {
		expect(formatDuties(C, ["breakdown_b", "setup_a"])).toBe(
			"Set Up (A) · Break Down (B)",
		);
	});

	it("is null when nothing is assigned, so callers can omit the line", () => {
		expect(formatDuties(C, [])).toBeNull();
		expect(formatDuties(C, ["not-a-duty"])).toBeNull();
	});
});

describe("the A/B pairing rule", () => {
	it("keeps the letter across both phases", () => {
		expect(pairedDutyFor(C, "setup_a")).toBe("breakdown_a");
		expect(pairedDutyFor(C, "setup_b")).toBe("breakdown_b");
		expect(pairedDutyFor(C, "breakdown_a")).toBe("setup_a");
		expect(pairedDutyFor(C, "breakdown_b")).toBe("setup_b");
	});

	it("has no pair for the in-session duties", () => {
		expect(pairedDutyFor(C, "host")).toBeNull();
		expect(pairedDutyFor(C, "customer_care")).toBeNull();
	});

	it("brings the matching half and the side's in-session duty along", () => {
		expect(toggleDuty(C, [], "setup_a")).toEqual([
			"setup_a",
			"customer_care",
			"breakdown_a",
		]);
		expect(toggleDuty(C, [], "breakdown_b")).toEqual([
			"setup_b",
			"host",
			"breakdown_b",
		]);
	});

	it("adds an in-session duty on its own, implying no halves", () => {
		expect(toggleDuty(C, ["setup_a"], "host")).toEqual(["setup_a", "host"]);
	});

	it("removes only what was clicked, so a pair can be split on purpose", () => {
		expect(toggleDuty(C, ["setup_a", "breakdown_a"], "breakdown_a")).toEqual([
			"setup_a",
		]);
	});

	it("lets an admin swap the in-session duty the side defaulted to", () => {
		const defaulted = toggleDuty(C, [], "setup_a");
		const swapped = toggleDuty(
			C,
			toggleDuty(C, defaulted, "customer_care"),
			"host",
		);
		expect(swapped).toEqual(["setup_a", "host", "breakdown_a"]);
	});

	it("lets someone working alone hold both halves of both phases", () => {
		const solo = toggleDuty(C, toggleDuty(C, [], "setup_a"), "setup_b");
		expect(solo).toEqual([
			"setup_a",
			"setup_b",
			"host",
			"customer_care",
			"breakdown_a",
			"breakdown_b",
		]);
		expect(mismatchedDutyPairs(C, solo)).toEqual([]);
	});

	it("sends the fire-and-water side to customer care, the space side to host", () => {
		const defaults = Object.fromEntries(
			C.map((d) => [d.key, d.sessionDefault]),
		);
		expect(defaults.setup_a).toBe("customer_care");
		expect(defaults.breakdown_a).toBe("customer_care");
		expect(defaults.setup_b).toBe("host");
		expect(defaults.breakdown_b).toBe("host");
	});
});

describe("mismatchedDutyPairs", () => {
	it("flags a letter split across the two phases", () => {
		expect(mismatchedDutyPairs(C, ["setup_a", "breakdown_b"])).toEqual([
			["setup_a", "breakdown_b"],
		]);
		expect(mismatchedDutyPairs(C, ["setup_b", "host", "breakdown_a"])).toEqual([
			["setup_b", "breakdown_a"],
		]);
	});

	it("is quiet when the letter is kept", () => {
		expect(mismatchedDutyPairs(C, ["setup_a", "host", "breakdown_a"])).toEqual(
			[],
		);
		expect(mismatchedDutyPairs(C, ["setup_b", "breakdown_b"])).toEqual([]);
	});

	it("is quiet on a half with no counterpart in the other phase", () => {
		expect(mismatchedDutyPairs(C, ["setup_a"])).toEqual([]);
		expect(mismatchedDutyPairs(C, ["host", "customer_care"])).toEqual([]);
	});
});

describe("the default catalog", () => {
	it("gives every duty a label and an SOP to open", () => {
		for (const duty of C) {
			expect(duty.label).toBeTruthy();
			expect(duty.sopSlug).toBeTruthy();
		}
	});

	it("says what each A/B half covers, since the letter alone does not", () => {
		expect(dutyTitle(C, "setup_a")).toBe("Set Up (A) — Fire + Water");
		expect(dutyTitle(C, "setup_b")).toBe("Set Up (B) — Space Prep");
		expect(dutyTitle(C, "breakdown_b")).toBe("Break Down (B) — Guest Areas");
		expect(dutyTitle(C, "host")).toBe("Host");
	});

	it("sorts every duty into exactly one phase", () => {
		const phased = dutyPhases(C).flatMap((phase) =>
			phase.duties.map((d) => d.key),
		);
		expect([...phased].sort()).toEqual(C.map((d) => d.key).sort());
	});
});

describe("an admin-edited catalog", () => {
	const duty = (
		over: Partial<DutyDef> & Pick<DutyDef, "key" | "phase">,
	): DutyDef => ({
		label: over.key,
		detail: null,
		side: null,
		sessionDefault: null,
		sopSlug: null,
		days: null,
		sortOrder: 10,
		archived: false,
		...over,
	});

	const custom: DutyCatalog = [
		...C,
		duty({
			key: "opening_checks",
			phase: "session",
			label: "Opening Checks",
			sortOrder: 2.5,
		}),
		duty({ key: "setup_c", phase: "setup", side: "b", archived: true }),
		duty({ key: "laundry_a", phase: "breakdown", side: "a", sortOrder: 6 }),
	];

	it("offers new duties in their phase, in sort order, and hides archived ones", () => {
		const phases = dutyPhases(custom);
		expect(phases.map((p) => p.key)).toEqual(["setup", "session", "breakdown"]);
		expect(phases[0].duties.map((d) => d.key)).toEqual(["setup_a", "setup_b"]);
		expect(phases[1].duties.map((d) => d.key)).toEqual([
			"host",
			"opening_checks",
			"customer_care",
		]);
	});

	it("pairs a set-up half with the first live break-down half on its side", () => {
		expect(pairedDutyFor(custom, "setup_a")).toBe("breakdown_a");
		expect(pairedDutyFor(custom, "laundry_a")).toBe("setup_a");
	});

	it("reads the pairing from sides, not keys", () => {
		expect(mismatchedDutyPairs(custom, ["setup_b", "laundry_a"])).toEqual([
			["setup_b", "laundry_a"],
		]);
		expect(mismatchedDutyPairs(custom, ["setup_a", "laundry_a"])).toEqual([]);
	});

	it("skips an in-session default that was deleted or archived", () => {
		const orphaned = C.filter((d) => d.key !== "customer_care");
		expect(toggleDuty(orphaned, [], "setup_a")).toEqual([
			"setup_a",
			"breakdown_a",
		]);
		const retired = C.map((d) =>
			d.key === "customer_care" ? { ...d, archived: true } : d,
		);
		expect(toggleDuty(retired, [], "setup_a")).toEqual([
			"setup_a",
			"breakdown_a",
		]);
	});

	it("lets one person hold several duties in the same phase", () => {
		const withPlunge: DutyCatalog = [
			...C,
			duty({ key: "plunge_care", phase: "setup", label: "Plunge Care", sortOrder: 1.5 }),
		];
		const held = toggleDuty(withPlunge, toggleDuty(withPlunge, [], "setup_a"), "plunge_care");
		expect(held).toEqual(["setup_a", "plunge_care", "customer_care", "breakdown_a"]);
		expect(formatDuties(withPlunge, held)).toBe(
			"Set Up (A) · Plunge Care · Customer Care · Break Down (A)",
		);
		// An unsplit duty never reads as a letter mismatch.
		expect(mismatchedDutyPairs(withPlunge, held)).toEqual([]);
		// Taking it off leaves the half and its pair alone.
		expect(toggleDuty(withPlunge, held, "plunge_care")).toEqual([
			"setup_a",
			"customer_care",
			"breakdown_a",
		]);
	});
});

describe("duty days", () => {
	// 2026-10-07 is a Wednesday, 2026-10-09 a Friday, 2026-10-11 a Sunday.
	const WED = "2026-10-07";
	const FRI = "2026-10-09";
	const SUN = "2026-10-11";
	const base = C[0] as DutyDef;
	const plants: DutyDef = {
		...base,
		key: "water_plants",
		label: "Water Plants",
		phase: "session",
		side: null,
		sessionDefault: null,
		days: [0, 5, 6],
	};
	const propaneStart: DutyDef = {
		...base,
		key: "weigh_propane",
		label: "Weigh Propane",
		phase: "setup",
		side: null,
		sessionDefault: null,
		days: [3],
	};
	const propaneEnd: DutyDef = {
		...propaneStart,
		key: "weigh_propane_2",
		phase: "breakdown",
		days: [0],
	};
	const catalog: DutyCatalog = [...C, plants, propaneStart, propaneEnd];

	it("stores one spelling: unique, ascending, and null for every day", () => {
		expect(normalizeDutyDays([6, 5, 0, 5])).toEqual([0, 5, 6]);
		expect(normalizeDutyDays([0, 1, 2, 3, 4, 5, 6])).toBeNull();
		expect(normalizeDutyDays([])).toBeNull();
		expect(normalizeDutyDays(null)).toBeNull();
		expect(normalizeDutyDays([7, -1, 1.5, 2])).toEqual([2]);
	});

	it("runs on its days only", () => {
		expect(dutyRunsOn(plants, FRI)).toBe(true);
		expect(dutyRunsOn(plants, SUN)).toBe(true);
		expect(dutyRunsOn(plants, WED)).toBe(false);
		expect(dutyRunsOn(base, WED)).toBe(true);
		expect(dutyRunsOn(propaneStart, WED)).toBe(true);
		expect(dutyRunsOn(propaneEnd, WED)).toBe(false);
	});

	it("reads Monday first, with runs of three or more as a range", () => {
		expect(formatDutyDays(null)).toBe("Every day");
		expect(formatDutyDays([0, 5, 6])).toBe("Fri–Sun");
		expect(formatDutyDays([3])).toBe("Wed");
		expect(formatDutyDays([0, 6])).toBe("Sat, Sun");
		expect(formatDutyDays([1, 3, 4, 5])).toBe("Mon, Wed–Fri");
	});

	it("flags held duties the day doesn't call for", () => {
		const held = ["setup_a", "water_plants", "weigh_propane_2"];
		expect(offDayDuties(catalog, held, WED)).toEqual(["water_plants", "weigh_propane_2"]);
		expect(offDayDuties(catalog, held, SUN)).toEqual([]);
		expect(offDayDuties(catalog, ["host"], WED)).toEqual([]);
	});

	it("doesn't fill in a pair or in-session duty that isn't done that day", () => {
		const weekendCare = C.map((d) =>
			d.key === "customer_care" ? { ...d, days: [0, 6] } : d,
		);
		expect(toggleDuty(weekendCare, [], "setup_a", { date: WED })).toEqual([
			"setup_a",
			"breakdown_a",
		]);
		expect(toggleDuty(weekendCare, [], "setup_a", { date: SUN })).toEqual([
			"setup_a",
			"customer_care",
			"breakdown_a",
		]);
		// Without a date, nothing is held back.
		expect(toggleDuty(weekendCare, [], "setup_a")).toEqual([
			"setup_a",
			"customer_care",
			"breakdown_a",
		]);
	});
});
