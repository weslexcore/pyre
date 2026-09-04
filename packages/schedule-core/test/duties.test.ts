// The duty vocabulary: an assignment's jobs (set up, work the session, break
// down), independent of the role that sets its hours. Two rules live here —
// normalising, because the array check constraint can neither dedupe nor
// order, and the pairing (whoever takes A at set-up takes A at break down).

import { describe, expect, it } from "vitest";
import {
	ASSIGNMENT_DUTIES,
	ASSIGNMENT_DUTY_DETAILS,
	ASSIGNMENT_DUTY_LABELS,
	ASSIGNMENT_DUTY_SOPS,
	mismatchedDutyPairs,
	DUTY_PHASES,
	DUTY_SIDE_DEFAULTS,
	formatDuties,
	normalizeDuties,
	pairedDutyFor,
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
	it("keeps the letter across both phases", () => {
		expect(pairedDutyFor("setup_a")).toBe("breakdown_a");
		expect(pairedDutyFor("setup_b")).toBe("breakdown_b");
		expect(pairedDutyFor("breakdown_a")).toBe("setup_a");
		expect(pairedDutyFor("breakdown_b")).toBe("setup_b");
	});

	it("has no pair for the in-session duties", () => {
		expect(pairedDutyFor("host")).toBeNull();
		expect(pairedDutyFor("customer_care")).toBeNull();
	});

	it("brings the matching half and the side's in-session duty along", () => {
		expect(toggleDuty([], "setup_a")).toEqual([
			"setup_a",
			"customer_care",
			"breakdown_a",
		]);
		expect(toggleDuty([], "breakdown_b")).toEqual([
			"setup_b",
			"host",
			"breakdown_b",
		]);
	});

	it("adds an in-session duty on its own, implying no halves", () => {
		expect(toggleDuty(["setup_a"], "host")).toEqual(["setup_a", "host"]);
	});

	it("removes only what was clicked, so a pair can be split on purpose", () => {
		expect(toggleDuty(["setup_a", "breakdown_a"], "breakdown_a")).toEqual([
			"setup_a",
		]);
	});

	it("lets an admin swap the in-session duty the side defaulted to", () => {
		const defaulted = toggleDuty([], "setup_a");
		const swapped = toggleDuty(toggleDuty(defaulted, "customer_care"), "host");
		expect(swapped).toEqual(["setup_a", "host", "breakdown_a"]);
	});

	it("lets someone working alone hold both halves of both phases", () => {
		const solo = toggleDuty(toggleDuty([], "setup_a"), "setup_b");
		expect(solo).toEqual([
			"setup_a",
			"setup_b",
			"host",
			"customer_care",
			"breakdown_a",
			"breakdown_b",
		]);
		expect(mismatchedDutyPairs(solo)).toEqual([]);
	});
});

describe("DUTY_SIDE_DEFAULTS", () => {
	it("sends the fire-and-water side to customer care, the space side to host", () => {
		expect(DUTY_SIDE_DEFAULTS.setup_a).toBe("customer_care");
		expect(DUTY_SIDE_DEFAULTS.breakdown_a).toBe("customer_care");
		expect(DUTY_SIDE_DEFAULTS.setup_b).toBe("host");
		expect(DUTY_SIDE_DEFAULTS.breakdown_b).toBe("host");
	});
});

describe("mismatchedDutyPairs", () => {
	it("flags a letter split across the two phases", () => {
		expect(mismatchedDutyPairs(["setup_a", "breakdown_b"])).toEqual([
			["setup_a", "breakdown_b"],
		]);
		expect(mismatchedDutyPairs(["setup_b", "host", "breakdown_a"])).toEqual([
			["setup_b", "breakdown_a"],
		]);
	});

	it("is quiet when the letter is kept", () => {
		expect(mismatchedDutyPairs(["setup_a", "host", "breakdown_a"])).toEqual([]);
		expect(mismatchedDutyPairs(["setup_b", "breakdown_b"])).toEqual([]);
	});

	it("is quiet on a half with no counterpart in the other phase", () => {
		expect(mismatchedDutyPairs(["setup_a"])).toEqual([]);
		expect(mismatchedDutyPairs(["host", "customer_care"])).toEqual([]);
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
