import { describe, expect, it } from 'vitest';
import { addInterval, describeRepeat, nextRepeatDate, repeatRuleOf } from './recurrence';

describe('addInterval', () => {
  it('steps days and weeks across month and year ends', () => {
    expect(addInterval('2026-10-30', { every: 3, unit: 'day' })).toBe('2026-11-02');
    expect(addInterval('2026-12-28', { every: 1, unit: 'week' })).toBe('2027-01-04');
    expect(addInterval('2026-10-02', { every: 2, unit: 'week' })).toBe('2026-10-16');
  });

  it('keeps the day of the month, clamped to a short month', () => {
    expect(addInterval('2026-10-15', { every: 1, unit: 'month' })).toBe('2026-11-15');
    expect(addInterval('2027-01-30', { every: 1, unit: 'month' })).toBe('2027-02-28');
    expect(addInterval('2026-11-15', { every: 3, unit: 'month' })).toBe('2027-02-15');
  });

  it('keeps a month-end date on the month end', () => {
    expect(addInterval('2027-01-31', { every: 1, unit: 'month' })).toBe('2027-02-28');
    expect(addInterval('2027-02-28', { every: 1, unit: 'month' })).toBe('2027-03-31');
    expect(addInterval('2027-04-30', { every: 1, unit: 'month' })).toBe('2027-05-31');
  });

  it('steps years, leap day included', () => {
    expect(addInterval('2026-10-02', { every: 1, unit: 'year' })).toBe('2027-10-02');
    expect(addInterval('2028-02-29', { every: 1, unit: 'year' })).toBe('2029-02-28');
  });
});

describe('nextRepeatDate', () => {
  const weekly = { every: 1, unit: 'week' } as const;

  it('is one step on from a date still ahead', () => {
    expect(nextRepeatDate('2026-10-09', weekly, '2026-10-02')).toBe('2026-10-16');
  });

  it('never files a copy that is already due or late', () => {
    // Finished on the day it was due: next week, not today.
    expect(nextRepeatDate('2026-10-02', weekly, '2026-10-02')).toBe('2026-10-09');
    // Finished three weeks late: the next one after today.
    expect(nextRepeatDate('2026-09-10', weekly, '2026-10-02')).toBe('2026-10-08');
  });

  it('counts from today for a card that was never dated', () => {
    expect(nextRepeatDate(null, { every: 1, unit: 'month' }, '2026-10-02')).toBe('2026-11-02');
  });
});

describe('describing a rule', () => {
  it('reads like a person would say it', () => {
    expect(describeRepeat({ every: 1, unit: 'day' })).toBe('Daily');
    expect(describeRepeat({ every: 2, unit: 'week' })).toBe('Every 2 weeks');
    expect(describeRepeat({ every: 1, unit: 'year' })).toBe('Yearly');
  });

  it('is null for a card that does not repeat', () => {
    expect(repeatRuleOf({ repeat_every: null, repeat_unit: null })).toBeNull();
    expect(repeatRuleOf({ repeat_every: 3, repeat_unit: 'month' })).toEqual({
      every: 3,
      unit: 'month',
    });
  });
});
