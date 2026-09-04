// The duty vocabulary: an assignment's jobs (set up, work the session, break
// down), independent of the role that sets its hours. Normalising is what
// keeps the stored array stable — the array check constraint can neither
// dedupe nor order.

import { describe, expect, it } from "vitest";
import {
	ASSIGNMENT_DUTIES,
	ASSIGNMENT_DUTY_LABELS,
	ASSIGNMENT_DUTY_SOPS,
	DUTY_PHASES,
	formatDuties,
	normalizeDuties,
} from "../src/constants";

describe("normalizeDuties", () => {
	it("orders duties by phase however they were clicked", () => {
		expect(normalizeDuties(["breakdown_b", "host", "setup"])).toEqual([
			"setup",
			"host",
			"breakdown_b",
		]);
	});

	it("drops duplicates and unknown values", () => {
		expect(normalizeDuties(["host", "host", "sweeping", ""])).toEqual(["host"]);
	});

	it("returns an empty array for an empty set", () => {
		expect(normalizeDuties([])).toEqual([]);
	});
});

describe("formatDuties", () => {
	it("joins the labels in phase order", () => {
		expect(formatDuties(["breakdown_a", "setup"])).toBe(
			"Setup · Break Down (A)",
		);
	});

	it("is null when nothing is assigned, so callers can omit the line", () => {
		expect(formatDuties([])).toBeNull();
		expect(formatDuties(["not-a-duty"])).toBeNull();
	});
});

describe("the duty vocabulary", () => {
	it("gives every duty a label and an SOP to open", () => {
		for (const duty of ASSIGNMENT_DUTIES) {
			expect(ASSIGNMENT_DUTY_LABELS[duty]).toBeTruthy();
			expect(ASSIGNMENT_DUTY_SOPS[duty]).toBeTruthy();
		}
	});

	it("sorts every duty into exactly one phase", () => {
		const phased = DUTY_PHASES.flatMap((phase) => [...phase.duties]);
		expect([...phased].sort()).toEqual([...ASSIGNMENT_DUTIES].sort());
	});
});
