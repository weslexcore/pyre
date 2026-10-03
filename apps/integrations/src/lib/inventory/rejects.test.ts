import { describe, expect, it } from 'vitest';
import { rejectRate, rejectValueCents, weeklyRejects, weekStart } from './rejects';

describe('weekStart', () => {
  it('finds the Monday on the studio clock', () => {
    expect(weekStart('2026-10-07T15:00:00Z')).toBe('2026-10-05'); // Wednesday
    expect(weekStart('2026-10-05T14:00:00Z')).toBe('2026-10-05'); // Monday
    expect(weekStart('2026-10-11T23:00:00Z')).toBe('2026-10-05'); // Sunday 7pm ET
    // Monday 01:00 UTC is still Sunday evening in New York: the week before.
    expect(weekStart('2026-10-12T01:00:00Z')).toBe('2026-10-05');
  });
});

describe('rejectRate', () => {
  it('is rejected over delivered, to one decimal', () => {
    expect(rejectRate(5, 48)).toBe(10.4);
    expect(rejectRate(0, 48)).toBe(0);
    expect(rejectRate(0, 0)).toBeNull();
  });
});

describe('weeklyRejects', () => {
  const now = new Date('2026-10-14T15:00:00Z'); // Wednesday, week of Oct 12

  it('lays out the last N weeks, delivered = accepted + rejected', () => {
    const weeks = weeklyRejects(
      [
        { occurred_at: '2026-10-06T14:00:00Z', quantity: 43 },
        { occurred_at: '2026-10-13T14:00:00Z', quantity: 46 },
        { occurred_at: '2026-09-01T14:00:00Z', quantity: 99 }, // outside the window
      ],
      [
        { received_at: '2026-10-06T14:00:00Z', rejected_qty: 5, unit_cost_cents: 250 },
        { received_at: '2026-10-13T14:00:00Z', rejected_qty: 2, unit_cost_cents: 250 },
      ],
      3,
      now
    );
    expect(weeks).toEqual([
      { week: '2026-09-28', delivered: 0, rejected: 0, rejectedCents: 0 },
      { week: '2026-10-05', delivered: 48, rejected: 5, rejectedCents: 1250 },
      { week: '2026-10-12', delivered: 48, rejected: 2, rejectedCents: 500 },
    ]);
  });
});

describe('rejectValueCents', () => {
  it('values a reject at its unit cost', () => {
    expect(rejectValueCents({ rejected_qty: 5, unit_cost_cents: 250 })).toBe(1250);
    expect(rejectValueCents({ rejected_qty: 5, unit_cost_cents: null })).toBeNull();
  });
});
