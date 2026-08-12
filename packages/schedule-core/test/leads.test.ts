// The shift-lead rule: a staffed shift is flagged when nobody on it can
// anchor (neither a founder nor a flagged shift lead). Drafts and empty
// shifts must never trip it.

import { describe, expect, it } from "vitest";
import { canLeadShift, missingShiftLead } from "../src/leads";

const roster = (
	entries: Array<[string, { is_founder?: boolean; is_shift_lead?: boolean }]>,
) =>
	new Map(
		entries.map(([id, flags]) => [
			id,
			{
				is_founder: flags.is_founder ?? false,
				is_shift_lead: flags.is_shift_lead ?? false,
			},
		]),
	);

const on = (staffId: string, isDraft = false) => ({
	staff_id: staffId,
	is_draft: isDraft,
});

describe("canLeadShift", () => {
	it("accepts founders and flagged leads, rejects everyone else", () => {
		expect(canLeadShift({ is_founder: true, is_shift_lead: false })).toBe(true);
		expect(canLeadShift({ is_founder: false, is_shift_lead: true })).toBe(true);
		expect(canLeadShift({ is_founder: false, is_shift_lead: false })).toBe(
			false,
		);
	});
});

describe("missingShiftLead", () => {
	const staff = roster([
		["founder", { is_founder: true }],
		["lead", { is_shift_lead: true }],
		["crew", {}],
	]);

	it("is fine with an empty shift (that is uncovered, not lead-less)", () => {
		expect(missingShiftLead([], staff)).toBe(false);
	});

	it("flags a crew with no founder or lead", () => {
		expect(missingShiftLead([on("crew")], staff)).toBe(true);
	});

	it("passes once a founder or lead is on", () => {
		expect(missingShiftLead([on("crew"), on("founder")], staff)).toBe(false);
		expect(missingShiftLead([on("crew"), on("lead")], staff)).toBe(false);
	});

	it("ignores draft assignments — a drafted lead is not coverage yet", () => {
		expect(missingShiftLead([on("crew"), on("lead", true)], staff)).toBe(true);
		// ...and a shift whose only crew is drafts is treated as empty.
		expect(missingShiftLead([on("crew", true)], staff)).toBe(false);
	});

	it("treats an unknown staff id as unable to lead", () => {
		expect(missingShiftLead([on("ghost")], staff)).toBe(true);
	});
});
