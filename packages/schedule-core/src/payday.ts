// Paydays: when pay lands, from the pay schedule an admin sets in the board's
// ⚙ Settings panel (the pay_schedule table). Shown on the Week and Calendar
// views, and as all-day events in the personal calendar feed of anyone who
// opted in (staff.calendar_payday).
//
// A schedule is a cadence plus a business-day rule. The cadence produces the
// nominal dates — every week or two from a known payday, or fixed days of the
// month — and the rule moves any that land on a weekend or a Federal Reserve
// holiday (when banks don't settle direct deposits) to the business day
// before or after. Dates are YYYY-MM-DD calendar days; nothing here touches a
// clock or a time zone.

import { dayOfWeek } from "./availability";
import { addDays } from "./hours";

export const PAY_FREQUENCIES = [
	"weekly",
	"biweekly",
	"semimonthly",
	"monthly",
] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = {
	weekly: "Every week",
	biweekly: "Every two weeks",
	semimonthly: "Twice a month",
	monthly: "Once a month",
};

/** What happens to a payday that lands on a weekend or bank holiday. */
export const PAYDAY_SHIFT_RULES = ["before", "after", "none"] as const;
export type PaydayShiftRule = (typeof PAYDAY_SHIFT_RULES)[number];

export const PAYDAY_SHIFT_RULE_LABELS: Record<PaydayShiftRule, string> = {
	before: "Paid the business day before",
	after: "Paid the business day after",
	none: "Paid that day anyway",
};

/** A day-of-month at or past this reads as the month's last day. */
export const LAST_DAY_OF_MONTH = 31;

export interface PaySchedule {
	/** Off = no paydays anywhere (the schedule is kept for turning back on). */
	enabled: boolean;
	frequency: PayFrequency;
	/** weekly / biweekly: any one nominal payday; the rest step from it. */
	anchorDate: string | null;
	/**
	 * semimonthly: two days of the month; monthly: one. 31 means the last day,
	 * and any day past a short month's end clamps to it (30 in February is the
	 * 28th or 29th).
	 */
	daysOfMonth: number[];
	shiftRule: PaydayShiftRule;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ymd(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The nth (1-based) given weekday of a month; n = -1 is the last one. */
function nthWeekday(
	year: number,
	month: number,
	weekday: number,
	n: number,
): string {
	if (n > 0) {
		const firstDow = dayOfWeek(ymd(year, month, 1));
		return ymd(year, month, 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7);
	}
	const lastDay = daysInMonth(year, month);
	const lastDow = dayOfWeek(ymd(year, month, lastDay));
	return ymd(year, month, lastDay - ((lastDow - weekday + 7) % 7));
}

/**
 * The Federal Reserve's bank holidays for a year, as observed — the days
 * direct deposits don't settle. A holiday on a Sunday is observed the Monday
 * after; one on a Saturday is not observed at all (the Fed stays open the
 * Friday before), so that Saturday is simply a weekend day.
 */
export function bankHolidays(year: number): Set<string> {
	const fixed = [
		ymd(year, 1, 1), // New Year's Day
		ymd(year, 6, 19), // Juneteenth
		ymd(year, 7, 4), // Independence Day
		ymd(year, 11, 11), // Veterans Day
		ymd(year, 12, 25), // Christmas Day
	].map((date) => (dayOfWeek(date) === 0 ? addDays(date, 1) : date));

	return new Set([
		...fixed,
		nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
		nthWeekday(year, 2, 1, 3), // Washington's Birthday
		nthWeekday(year, 5, 1, -1), // Memorial Day
		nthWeekday(year, 9, 1, 1), // Labor Day
		nthWeekday(year, 10, 1, 2), // Columbus Day
		nthWeekday(year, 11, 4, 4), // Thanksgiving
	]);
}

const holidayCache = new Map<number, Set<string>>();

export function isBusinessDay(date: string): boolean {
	const dow = dayOfWeek(date);
	if (dow === 0 || dow === 6) return false;
	const year = Number(date.slice(0, 4));
	let holidays = holidayCache.get(year);
	if (!holidays) {
		holidays = bankHolidays(year);
		holidayCache.set(year, holidays);
	}
	return !holidays.has(date);
}

/** A nominal payday moved off a weekend or bank holiday per the rule. */
export function adjustPayday(date: string, rule: PaydayShiftRule): string {
	if (rule === "none") return date;
	const step = rule === "before" ? -1 : 1;
	let day = date;
	while (!isBusinessDay(day)) day = addDays(day, step);
	return day;
}

/** Whole days from a to b (b - a). */
function daysBetween(a: string, b: string): number {
	return Math.round(
		(Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
	);
}

/** Nominal (unadjusted) paydays from `start` through `end`, inclusive. */
function nominalPaydays(
	schedule: PaySchedule,
	start: string,
	end: string,
): string[] {
	const dates: string[] = [];

	if (schedule.frequency === "weekly" || schedule.frequency === "biweekly") {
		if (!schedule.anchorDate) return dates;
		const step = schedule.frequency === "weekly" ? 7 : 14;
		// First step on/after start, counted from the anchor in either direction.
		const offset = daysBetween(schedule.anchorDate, start);
		const steps = Math.ceil(offset / step);
		for (
			let day = addDays(schedule.anchorDate, steps * step);
			day <= end;
			day = addDays(day, step)
		) {
			dates.push(day);
		}
		return dates;
	}

	const wanted = schedule.frequency === "monthly" ? 1 : 2;
	const days = [...new Set(schedule.daysOfMonth)].slice(0, wanted);
	if (days.length < wanted) return dates;

	let year = Number(start.slice(0, 4));
	let month = Number(start.slice(5, 7));
	while (ymd(year, month, 1) <= end) {
		const last = daysInMonth(year, month);
		for (const day of days) {
			const date = ymd(year, month, Math.min(day, last));
			if (date >= start && date <= end) dates.push(date);
		}
		month += 1;
		if (month > 12) {
			month = 1;
			year += 1;
		}
	}
	return dates.sort();
}

/**
 * Actual paydays from `start` through `end` (inclusive), sorted and distinct.
 * Nominal dates a week either side are considered too, so a payday moved
 * into the range from just outside it is still found.
 */
export function paydaysBetween(
	schedule: PaySchedule,
	start: string,
	end: string,
): string[] {
	if (!schedule.enabled || end < start) return [];
	const nominal = nominalPaydays(schedule, addDays(start, -7), addDays(end, 7));
	const actual = nominal
		.map((date) => adjustPayday(date, schedule.shiftRule))
		.filter((date) => date >= start && date <= end);
	return [...new Set(actual)].sort();
}

/** The next `count` paydays on or after `from`. */
export function upcomingPaydays(
	schedule: PaySchedule,
	from: string,
	count: number,
): string[] {
	// Monthly is the sparsest cadence: a year out always holds `count` of them
	// for any count a preview would ask for.
	return paydaysBetween(schedule, from, addDays(from, 400)).slice(0, count);
}

/**
 * Check and normalize a schedule from an untrusted body. The cadence fields
 * the frequency doesn't use are cleared so the stored row says only what
 * applies.
 */
export function parsePaySchedule(
	value: unknown,
): PaySchedule | { error: string } {
	if (!value || typeof value !== "object")
		return { error: "Pay schedule must be an object" };
	const body = value as Record<string, unknown>;

	if (typeof body.enabled !== "boolean")
		return { error: "enabled must be true or false" };
	const frequency = body.frequency;
	if (
		typeof frequency !== "string" ||
		!(PAY_FREQUENCIES as readonly string[]).includes(frequency)
	) {
		return { error: `frequency must be one of: ${PAY_FREQUENCIES.join(", ")}` };
	}
	const shiftRule = body.shiftRule;
	if (
		typeof shiftRule !== "string" ||
		!(PAYDAY_SHIFT_RULES as readonly string[]).includes(shiftRule)
	) {
		return {
			error: `shiftRule must be one of: ${PAYDAY_SHIFT_RULES.join(", ")}`,
		};
	}

	const freq = frequency as PayFrequency;
	if (freq === "weekly" || freq === "biweekly") {
		const anchor = body.anchorDate;
		if (
			typeof anchor !== "string" ||
			!DATE_RE.test(anchor) ||
			Number.isNaN(Date.parse(`${anchor}T00:00:00Z`))
		) {
			return {
				error: "Pick one payday (YYYY-MM-DD) for the rest to count from",
			};
		}
		return {
			enabled: body.enabled,
			frequency: freq,
			anchorDate: anchor,
			daysOfMonth: [],
			shiftRule: shiftRule as PaydayShiftRule,
		};
	}

	const wanted = freq === "monthly" ? 1 : 2;
	const days = body.daysOfMonth;
	if (
		!Array.isArray(days) ||
		days.length !== wanted ||
		!days.every((d) => Number.isInteger(d) && d >= 1 && d <= LAST_DAY_OF_MONTH)
	) {
		return {
			error:
				wanted === 1
					? "Pick the day of the month pay lands"
					: "Pick the two days of the month pay lands",
		};
	}
	if (wanted === 2 && days[0] === days[1]) {
		return { error: "The two paydays must be different days of the month" };
	}
	return {
		enabled: body.enabled,
		frequency: freq,
		anchorDate: null,
		daysOfMonth: [...(days as number[])].sort((a, b) => a - b),
		shiftRule: shiftRule as PaydayShiftRule,
	};
}
