import { describe, expect, it } from 'vitest';
import type { BusinessCostRow } from '@/lib/db';
import { computeDailyCosts, type DailyCosts } from './costs';

const base = {
  id: 'c1',
  name: 'Test cost',
  category: 'other' as const,
  monthly_cap: null,
  cadence: null,
  incurred_on: null,
  effective_from: null,
  effective_to: null,
  notes: null,
  created_by: 'admin@pyresauna.com',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const cost = (over: Partial<BusinessCostRow>): BusinessCostRow =>
  ({ ...base, ...over }) as BusinessCostRow;

const sum = (days: DailyCosts[], pick: (d: DailyCosts) => number): number =>
  days.reduce((total, d) => total + pick(d), 0);

describe('computeDailyCosts', () => {
  it('emits a zero row for every day in range', () => {
    const days = computeDailyCosts({
      costs: [],
      start: '2026-08-01',
      end: '2026-08-03',
      openHoursByDate: new Map(),
      revenueByDate: new Map(),
    });
    expect(days.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(days.every((d) => d.fixed === 0 && d.rent === 0 && d.fees === 0)).toBe(true);
  });

  it('amortizes a monthly subscription so the month sums to the sticker price', () => {
    const days = computeDailyCosts({
      costs: [cost({ kind: 'recurring', cadence: 'monthly', amount: 62 })],
      start: '2026-08-01',
      end: '2026-08-31',
      openHoursByDate: new Map(),
      revenueByDate: new Map(),
    });
    expect(days[0].fixed).toBeCloseTo(2, 10); // 62 / 31 days
    expect(sum(days, (d) => d.fixed)).toBeCloseTo(62, 8);
  });

  it('spreads biweekly and weekly cadences by their period length', () => {
    const days = computeDailyCosts({
      costs: [
        cost({ id: 'laundry', kind: 'recurring', cadence: 'biweekly', amount: 200 }),
        cost({ id: 'weekly', kind: 'recurring', cadence: 'weekly', amount: 70 }),
      ],
      start: '2026-08-01',
      end: '2026-08-14',
      openHoursByDate: new Map(),
      revenueByDate: new Map(),
    });
    // 14 days: one full biweekly period + two weekly periods.
    expect(sum(days, (d) => d.fixed)).toBeCloseTo(200 + 140, 8);
  });

  it('puts a one-off purchase entirely on its incurred day', () => {
    const days = computeDailyCosts({
      costs: [cost({ kind: 'one_off', amount: 475, incurred_on: '2026-08-12' })],
      start: '2026-08-10',
      end: '2026-08-14',
      openHoursByDate: new Map(),
      revenueByDate: new Map(),
    });
    expect(days.find((d) => d.date === '2026-08-12')?.fixed).toBe(475);
    expect(sum(days, (d) => d.fixed)).toBe(475);
  });

  it('ignores a one-off outside the range', () => {
    const days = computeDailyCosts({
      costs: [cost({ kind: 'one_off', amount: 475, incurred_on: '2026-07-30' })],
      start: '2026-08-01',
      end: '2026-08-05',
      openHoursByDate: new Map(),
      revenueByDate: new Map(),
    });
    expect(sum(days, (d) => d.fixed)).toBe(0);
  });

  it('charges per open hour and clamps at the monthly cap', () => {
    // $50/hr, 6 open hours a day: hits a $1,000 cap during day 4.
    const openHours = new Map(
      ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'].map((d) => [d, 6])
    );
    const days = computeDailyCosts({
      costs: [cost({ kind: 'per_open_hour', amount: 50, monthly_cap: 1000 })],
      start: '2026-08-01',
      end: '2026-08-05',
      openHoursByDate: openHours,
      revenueByDate: new Map(),
    });
    expect(days.map((d) => d.rent)).toEqual([300, 300, 300, 100, 0]);
  });

  it('accrues the cap from the top of the month when the range starts mid-month', () => {
    // Hours on Aug 1–10 (6/day = $300/day) exhaust a $4,250 cap partway
    // through Aug 15 even though we only emit from Aug 14.
    const openHours = new Map<string, number>();
    for (let i = 1; i <= 20; i++) {
      openHours.set(`2026-08-${String(i).padStart(2, '0')}`, 6);
    }
    const days = computeDailyCosts({
      costs: [cost({ kind: 'per_open_hour', amount: 50, monthly_cap: 4250 })],
      start: '2026-08-14',
      end: '2026-08-16',
      openHoursByDate: openHours,
      revenueByDate: new Map(),
    });
    // Aug 1–13 accrued 13 x 300 = 3,900; Aug 14 charges 300, Aug 15 the
    // remaining 50, Aug 16 nothing.
    expect(days.map((d) => d.rent)).toEqual([300, 50, 0]);
  });

  it('resets the cap each calendar month', () => {
    const openHours = new Map([
      ['2026-08-31', 10],
      ['2026-09-01', 10],
    ]);
    const days = computeDailyCosts({
      costs: [cost({ kind: 'per_open_hour', amount: 50, monthly_cap: 400 })],
      start: '2026-08-31',
      end: '2026-09-01',
      openHoursByDate: openHours,
      revenueByDate: new Map(),
    });
    expect(days.map((d) => d.rent)).toEqual([400, 400]);
  });

  it('takes a percentage of days with known revenue only', () => {
    const days = computeDailyCosts({
      costs: [cost({ kind: 'percent_of_revenue', amount: 3 })],
      start: '2026-08-01',
      end: '2026-08-03',
      openHoursByDate: new Map(),
      revenueByDate: new Map([
        ['2026-08-01', 1000],
        // 08-02 has no data — contributes nothing rather than 3% of zero.
        ['2026-08-03', 500],
      ]),
    });
    expect(days.map((d) => d.fees)).toEqual([30, 0, 15]);
  });

  it('respects effective windows on recurring and computed costs', () => {
    const days = computeDailyCosts({
      costs: [
        cost({
          kind: 'recurring',
          cadence: 'monthly',
          amount: 310,
          effective_from: '2026-08-11',
          effective_to: '2026-08-20',
        }),
      ],
      start: '2026-08-01',
      end: '2026-08-31',
      openHoursByDate: new Map(),
      revenueByDate: new Map(),
    });
    // 310/31 = $10/day for exactly the 10 days inside the window.
    expect(sum(days, (d) => d.fixed)).toBeCloseTo(100, 8);
    expect(days.find((d) => d.date === '2026-08-10')?.fixed).toBe(0);
    expect(days.find((d) => d.date === '2026-08-11')?.fixed).toBeCloseTo(10, 10);
  });
});
