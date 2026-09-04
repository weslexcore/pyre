// The duty vocabulary: an assignment's jobs (set up, work the session, break
// down), independent of the role that sets its hours. Two rules live here —
// normalising, because the array check constraint can neither dedupe nor
// order, and the cross-phase pairing (A at set-up, B at break down).

import { describe, expect, it } from "vitest";
import {
	ASSIGNMENT_DUTIES,
	ASSIGNMENT_DUTY_DETAILS,
	ASSIGNMENT_DUTY_LABELS,
	ASSIGNMENT_DUTY_SOPS,
	crossPairFor,
	crossPairMismatches,
	DUTY_PHASES,
	formatDuties,
	normalizeDuties,
	toggleDuty,
} from "../src/constants";

describe("normalizeDuties", () => {
	it("orders duties by phase however they were clicked", () => {
		expect(normalizeDuties(["breakdown_b", "host", "setup_a"])).toEqual([
			"setup_a",
			"host",
			"breakdown_b",
		]);
	});

	it("drops duplicates and unknown values", () => {
		expect(normalizeDuties(["host", "host", "setup", "sweeping"])).toEqual([
			"host",
		]);
	});
});

describe("formatDuties", () => {
	it("joins the labels in phase order", () => {
		expect(formatDuties(["breakdown_b", "setup_a"])).toBe(
			"Set Up (A) · Break Down (B)",
		);
	});

	it("is null when nothing is assigned, so callers can omit the line", () => {
		expect(formatDuties([])).toBeNull();
		expect(formatDuties(["not-a-duty"])).toBeNull();
	});
});

describe("the A/B pairing rule", () => {
	it("pairs each set-up half with the opposite break-down half", () => {
		expect(crossPairFor("setup_a")).toBe("breakdown_b");
		expect(crossPairFor("setup_b")).toBe("breakdown_a");
		expect(crossPairFor("breakdown_a")).toBe("setup_b");
		expect(crossPairFor("breakdown_b")).toBe("setup_a");
	});

	it("has no pair for the in-session duties", () => {
		expect(crossPairFor("host")).toBeNull();
		expect(crossPairFor("customer_care")).toBeNull();
	});

	it("brings the paired half along when a half is taken", () => {
		expect(toggleDuty([], "setup_a")).toEqual(["setup_a", "breakdown_b"]);
		expect(toggleDuty([], "breakdown_a")).toEqual(["setup_b", "breakdown_a"]);
	});

	it("adds an in-session duty on its own", () => {
		expect(toggleDuty(["setup_a"], "host")).toEqual([
			"setup_a",
			"host",
		]);
	});

	it("removes only what was clicked, so a pair can be broken on purpose", () => {
		expect(toggleDuty(["setup_a", "breakdown_b"], "breakdown_b")).toEqual([
			"setup_a",
		]);
	});

	it("lets someone working alone hold both halves of both phases", () => {
		const solo = toggleDuty(toggleDuty([], "setup_a"), "setup_b");
		expect(solo).toEqual([
			"setup_a",
			"setup_b",
			"breakdown_a",
			"breakdown_b",
		]);
		expect(crossPairMismatches(solo)).toEqual([]);
	});
});

describe("crossPairMismatches", () => {
	it("flags the same side held in both phases", () => {
		expect(crossPairMismatches(["setup_a", "breakdown_a"])).toEqual([
			["setup_a", "breakdown_a"],
		]);
		expect(crossPairMismatches(["setup_b", "host", "breakdown_b"])).toEqual([
			["setup_b", "breakdown_b"],
		]);
	});

	it("is quiet on a correctly crossed pair", () => {
		expect(crossPairMismatches(["setup_a", "host", "breakdown_b"])).toEqual([]);
		expect(crossPairMismatches(["setup_b", "breakdown_a"])).toEqual([]);
	});

	it("is quiet on a half with no counterpart in the other phase", () => {
		expect(crossPairMismatches(["setup_a"])).toEqual([]);
		expect(crossPairMismatches(["host", "customer_care"])).toEqual([]);
	});
});

describe("the duty vocabulary", () => {
	it("gives every duty a label and an SOP to open", () => {
		for (const duty of ASSIGNMENT_DUTIES) {
			expect(ASSIGNMENT_DUTY_LABELS[duty]).toBeTruthy();
			expect(ASSIGNMENT_DUTY_SOPS[duty]).toBeTruthy();
		}
	});

	it("says what each A/B half covers, since the letter alone does not", () => {
		expect(ASSIGNMENT_DUTY_DETAILS.setup_a).toBe("Fire + Water");
		expect(ASSIGNMENT_DUTY_DETAILS.setup_b).toBe("Space Prep");
		expect(ASSIGNMENT_DUTY_DETAILS.breakdown_b).toBe("Guest Areas");
		expect(ASSIGNMENT_DUTY_DETAILS.host).toBeNull();
	});

	it("sorts every duty into exactly one phase", () => {
		const phased = DUTY_PHASES.flatMap((phase) => [...phase.duties]);
		expect([...phased].sort()).toEqual([...ASSIGNMENT_DUTIES].sort());
	});
});
