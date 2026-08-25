// Daily amortization of admin-entered operating costs (business_costs table)
// for /api/admin/business-overview — the same role lib/schedule/labor.ts
// plays for labor: one number per ET day, so the API can re-bucket into
// day/week/month at read time and price arbitrary ranges.
//
// Kinds and how they land on days:
//   recurring           amount spread over its cadence — /7 weekly, /14
//                       biweekly, /days-in-that-month monthly, /days-in-that-
//                       year yearly — so a month of days always sums back to
//                       the sticker price.
//   one_off             the whole amount on the day it was incurred.
//   per_open_hour       rate x that day's customer-facing open hours,
//                       accrued in day order within each calendar month and
//                       clamped at monthly_cap. Because the cap depends on
//                       hours earlier in the month, callers must supply open
//                       hours from the FIRST of the month containing `start`,
//                       not just the emitted range.
//   percent_of_revenue  rate% of that day's known Momence revenue; days with
//                       no revenue data contribute nothing (the overview
//                       renders profit as unknown there anyway).
//
// Pure math on data the caller already fetched — no Supabase in here, which
// keeps it trivially testable.

import { addDays } from '@pyre/schedule-core';
import type { BusinessCostRow } from '@/lib/db';

export interface DailyCosts {
  /** ET calendar day, YYYY-MM-DD. */
  date: string;
  /** Recurring subscriptions (amortized) plus one-off purchases. */
  fixed: number;
  /** per_open_hour charges, monthly cap applied. */
  rent: number;
  /** percent_of_revenue charges. */
  fees: number;
}

export const monthStartOf = (date: string): string => `${date.slice(0, 7)}-01`;

const daysInMonth = (date: string): number => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

const daysInYear = (date: string): number => {
  const year = Number(date.slice(0, 4));
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
};

/** Whether a cost definition applies on `day` (one_offs handle their own date). */
const activeOn = (cost: BusinessCostRow, day: string): boolean =>
  (cost.effective_from === null || day >= cost.effective_from) &&
  (cost.effective_to === null || day <= cost.effective_to);

/** A recurring cost's share of one day, by cadence. */
function recurringDailyShare(cost: BusinessCostRow, day: string): number {
  const amount = Number(cost.amount);
  switch (cost.cadence) {
    case 'weekly':
      return amount / 7;
    case 'biweekly':
      return amount / 14;
    case 'yearly':
      return amount / daysInYear(day);
    default:
      // monthly (the cadence column is constrained, so default = monthly)
      return amount / daysInMonth(day);
  }
}

export interface DailyCostInputs {
  costs: BusinessCostRow[];
  /** First and last day to emit, YYYY-MM-DD ET, inclusive. */
  start: string;
  end: string;
  /** Customer-facing open hours per day — must cover monthStartOf(start)
   * through end so per_open_hour caps accrue from the top of the month. */
  openHoursByDate: Map<string, number>;
  /** Known Momence revenue per day (absent = no data, not zero). */
  revenueByDate: Map<string, number>;
}

/** Per-day cost rows over [start, end]; every day is emitted, zeros included,
 * so callers can index without existence checks. */
export function computeDailyCosts(inputs: DailyCostInputs): DailyCosts[] {
  const { costs, start, end, openHoursByDate, revenueByDate } = inputs;

  const recurring = costs.filter((c) => c.kind === 'recurring');
  const perHour = costs.filter((c) => c.kind === 'per_open_hour');
  const percent = costs.filter((c) => c.kind === 'percent_of_revenue');
  const oneOffByDay = new Map<string, number>();
  for (const cost of costs) {
    if (cost.kind !== 'one_off' || cost.incurred_on === null) continue;
    oneOffByDay.set(
      cost.incurred_on,
      (oneOffByDay.get(cost.incurred_on) ?? 0) + Number(cost.amount)
    );
  }

  // Walk from the top of start's month so caps accrue correctly, but only
  // emit days inside the requested range.
  const out: DailyCosts[] = [];
  // Per per_open_hour cost: dollars already accrued in the current month.
  const capAccrued = new Map<string, number>();
  let currentMonth = '';

  for (let day = monthStartOf(start); day <= end; day = addDays(day, 1)) {
    const month = day.slice(0, 7);
    if (month !== currentMonth) {
      currentMonth = month;
      capAccrued.clear();
    }

    let rent = 0;
    const openHours = openHoursByDate.get(day) ?? 0;
    for (const cost of perHour) {
      if (!activeOn(cost, day)) continue;
      let charge = Number(cost.amount) * openHours;
      if (cost.monthly_cap !== null) {
        const accrued = capAccrued.get(cost.id) ?? 0;
        charge = Math.min(charge, Math.max(Number(cost.monthly_cap) - accrued, 0));
        capAccrued.set(cost.id, accrued + charge);
      }
      rent += charge;
    }

    if (day < start) continue;

    let fixed = oneOffByDay.get(day) ?? 0;
    for (const cost of recurring) {
      if (activeOn(cost, day)) fixed += recurringDailyShare(cost, day);
    }

    let fees = 0;
    const revenue = revenueByDate.get(day);
    if (revenue !== undefined) {
      for (const cost of percent) {
        if (activeOn(cost, day)) fees += (Number(cost.amount) / 100) * revenue;
      }
    }

    out.push({ date: day, fixed, rent, fees });
  }

  return out;
}
