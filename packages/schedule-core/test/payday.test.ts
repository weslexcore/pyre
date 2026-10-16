// Paydays from a pay schedule: the cadence makes the nominal dates, the
// business-day rule moves any that land on a weekend or bank holiday.

import { describe, expect, it } from "vitest";
import {
	adjustPayday,
	bankHolidays,
	isBusinessDay,
	type PaySchedule,
	parsePaySchedule,
	paydaysBetween,
	upcomingPaydays,
} from "../src/payday";

const biweekly: PaySchedule = {
	enabled: true,
	frequency: "biweekly",
	anchorDate: "2026-08-17",
	daysOfMonth: [],
	shiftRule: "before",
};

describe("bank holidays", () => {
	it("lists the 2026 Federal Reserve holidays", () => {
		expect([...bankHolidays(2026)].sort()).toEqual([
			"2026-01-01",
			"2026-01-19",
			"2026-02-16",
			"2026-05-25",
			"2026-06-19",
			// A Saturday — listed, but a weekend day anyway; nothing moves to Friday.
			"2026-07-04",
			"2026-09-07",
			"2026-10-12",
			"2026-11-11",
			"2026-11-26",
			"2026-12-25",
		]);
	});

	it("observes a Sunday holiday on the Monday, but not a Saturday one", () => {
		// Juneteenth 2022 was a Sunday; July 4th 2026 is a Saturday.
		expect(bankHolidays(2022).has("2022-06-20")).toBe(true);
		expect(bankHolidays(2026).has("2026-07-03")).toBe(false);
	});

	it("treats weekends and holidays as non-business days", () => {
		expect(isBusinessDay("2026-10-16")).toBe(true); // Friday
		expect(isBusinessDay("2026-10-17")).toBe(false); // Saturday
		expect(isBusinessDay("2026-10-12")).toBe(false); // Columbus Day
	});
});

describe("adjustPayday", () => {
	it("moves a Labor Day payday to the Friday before, or the Tuesday after", () => {
		expect(adjustPayday("2026-09-07", "before")).toBe("2026-09-04");
		expect(adjustPayday("2026-09-07", "after")).toBe("2026-09-08");
		expect(adjustPayday("2026-09-07", "none")).toBe("2026-09-07");
	});
});

describe("paydaysBetween", () => {
	it("steps every two weeks from the anchor, both directions", () => {
		expect(paydaysBetween(biweekly, "2026-08-01", "2026-09-30")).toEqual([
			"2026-08-03",
			"2026-08-17",
			"2026-08-31",
			// 9/14 and 9/28 are ordinary Mondays.
			"2026-09-14",
			"2026-09-28",
		]);
	});

	it("pulls a holiday payday back into range from just outside it", () => {
		// Monday 10/12 is Columbus Day, so pay lands Friday 10/9.
		expect(paydaysBetween(biweekly, "2026-10-05", "2026-10-11")).toEqual([
			"2026-10-09",
		]);
		expect(paydaysBetween(biweekly, "2026-10-12", "2026-10-18")).toEqual([]);
	});

	it("steps weekly", () => {
		expect(
			paydaysBetween(
				{ ...biweekly, frequency: "weekly", anchorDate: "2026-10-16" },
				"2026-10-01",
				"2026-10-31",
			),
		).toEqual([
			"2026-10-02",
			"2026-10-09",
			"2026-10-16",
			"2026-10-23",
			"2026-10-30",
		]);
	});

	it("pays the 15th and the last day twice a month, clamped to short months", () => {
		const semimonthly: PaySchedule = {
			enabled: true,
			frequency: "semimonthly",
			anchorDate: null,
			daysOfMonth: [15, 31],
			shiftRule: "before",
		};
		// Feb 2027: the 15th is Presidents' Day (→ Fri 2/12), the 28th a Sunday (→ Fri 2/26).
		expect(paydaysBetween(semimonthly, "2027-02-01", "2027-02-28")).toEqual([
			"2027-02-12",
			"2027-02-26",
		]);
		expect(paydaysBetween(semimonthly, "2026-04-01", "2026-04-30")).toEqual([
			"2026-04-15",
			"2026-04-30",
		]);
	});

	it("pays once a month", () => {
		const monthly: PaySchedule = {
			enabled: true,
			frequency: "monthly",
			anchorDate: null,
			daysOfMonth: [1],
			shiftRule: "after",
		};
		// Jan 1 2027 is a holiday (Friday) → Monday Jan 4.
		expect(paydaysBetween(monthly, "2026-12-01", "2027-01-31")).toEqual([
			"2026-12-01",
			"2027-01-04",
		]);
	});

	it("has none when the schedule is off", () => {
		expect(
			paydaysBetween(
				{ ...biweekly, enabled: false },
				"2026-08-01",
				"2026-09-30",
			),
		).toEqual([]);
	});

	it("previews the next few", () => {
		expect(upcomingPaydays(biweekly, "2026-10-16", 3)).toEqual([
			"2026-10-26",
			"2026-11-09",
			"2026-11-23",
		]);
	});
});

describe("parsePaySchedule", () => {
	it("accepts a biweekly schedule and drops the month days", () => {
		expect(parsePaySchedule({ ...biweekly, daysOfMonth: [3] })).toEqual(
			biweekly,
		);
	});

	it("needs an anchor for weekly cadences", () => {
		expect(parsePaySchedule({ ...biweekly, anchorDate: null })).toHaveProperty(
			"error",
		);
	});

	it("needs two distinct days twice a month, sorted", () => {
		const base = {
			enabled: true,
			frequency: "semimonthly",
			anchorDate: "2026-01-01",
			shiftRule: "before",
		};
		expect(parsePaySchedule({ ...base, daysOfMonth: [31, 15] })).toEqual({
			...base,
			anchorDate: null,
			daysOfMonth: [15, 31],
		});
		expect(parsePaySchedule({ ...base, daysOfMonth: [15, 15] })).toHaveProperty(
			"error",
		);
		expect(parsePaySchedule({ ...base, daysOfMonth: [15] })).toHaveProperty(
			"error",
		);
		expect(parsePaySchedule({ ...base, daysOfMonth: [0, 15] })).toHaveProperty(
			"error",
		);
	});

	it("rejects unknown frequencies and rules", () => {
		expect(
			parsePaySchedule({ ...biweekly, frequency: "daily" }),
		).toHaveProperty("error");
		expect(
			parsePaySchedule({ ...biweekly, shiftRule: "whenever" }),
		).toHaveProperty("error");
	});
});
