import { describe, expect, it } from 'vitest';
import { type Cadence, describeCadence, nextRunAt, parseRoutineInput } from './cadence';

const weekly = (weekdays: number[], hour: number): Cadence => ({
  frequency: 'weekly',
  weekdays,
  monthDay: null,
  hour,
});

describe('nextRunAt', () => {
  it('finds next Monday 8am Eastern from a Thursday (EDT)', () => {
    // Thu Oct 16 2026, noon EDT.
    expect(nextRunAt(weekly([1], 8), new Date('2026-10-16T16:00:00Z'))).toBe(
      '2026-10-19T12:00:00.000Z'
    );
  });

  it('runs later today when the hour has not come yet, and not when it has', () => {
    const cadence: Cadence = { frequency: 'daily', weekdays: [], monthDay: null, hour: 18 };
    expect(nextRunAt(cadence, new Date('2026-10-16T16:00:00Z'))).toBe('2026-10-16T22:00:00.000Z');
    // Exactly at the slot is not "after" it.
    expect(nextRunAt(cadence, new Date('2026-10-16T22:00:00Z'))).toBe('2026-10-17T22:00:00.000Z');
  });

  it('keeps the wall clock across the fall-back change (EST after Nov 1)', () => {
    expect(nextRunAt(weekly([1], 8), new Date('2026-10-30T16:00:00Z'))).toBe(
      '2026-11-02T13:00:00.000Z'
    );
  });

  it('finds a monthly day in the next month', () => {
    const cadence: Cadence = { frequency: 'monthly', weekdays: [], monthDay: 1, hour: 9 };
    expect(nextRunAt(cadence, new Date('2026-10-16T16:00:00Z'))).toBe('2026-11-01T14:00:00.000Z');
  });

  it('uses the Eastern date, not the UTC one, late in the evening', () => {
    // Sun Oct 18, 11pm EDT = Mon 03:00 UTC: Monday 8am is hours away, same day.
    expect(nextRunAt(weekly([1], 8), new Date('2026-10-19T03:00:00Z'))).toBe(
      '2026-10-19T12:00:00.000Z'
    );
  });
});

describe('describeCadence', () => {
  it('reads like a person would say it', () => {
    expect(describeCadence(weekly([1], 8))).toBe('Mondays at 8am');
    expect(describeCadence(weekly([1, 2, 3, 4, 5], 17))).toBe('Weekdays at 5pm');
    expect(describeCadence(weekly([1, 3, 5], 12))).toBe('Mondays, Wednesdays, and Fridays at 12pm');
    expect(describeCadence({ frequency: 'monthly', weekdays: [], monthDay: 2, hour: 0 })).toBe(
      'The 2nd of each month at 12am'
    );
    expect(describeCadence({ frequency: 'daily', weekdays: [], monthDay: null, hour: 7 })).toBe(
      'Every day at 7am'
    );
  });
});

describe('parseRoutineInput', () => {
  const base = { title: 'Weekly notes', prompt: 'Summarize the week', hour: 8 };

  it('accepts a weekly routine and tidies its days', () => {
    const parsed = parseRoutineInput({ ...base, frequency: 'weekly', weekdays: [5, 1, 1, 9] });
    expect(parsed).toEqual({
      ok: true,
      value: {
        title: 'Weekly notes',
        prompt: 'Summarize the week',
        cadence: { frequency: 'weekly', weekdays: [1, 5], monthDay: null, hour: 8 },
        enabled: true,
      },
    });
  });

  it('refuses a weekly routine with no days, a monthly one past the 28th, and a bad hour', () => {
    expect(parseRoutineInput({ ...base, frequency: 'weekly', weekdays: [] }).ok).toBe(false);
    expect(parseRoutineInput({ ...base, frequency: 'monthly', monthDay: 31 }).ok).toBe(false);
    expect(parseRoutineInput({ ...base, frequency: 'daily', hour: 24 }).ok).toBe(false);
    expect(parseRoutineInput({ ...base, frequency: 'hourly' }).ok).toBe(false);
    expect(parseRoutineInput({ ...base, title: ' ', frequency: 'daily' }).ok).toBe(false);
  });
});
