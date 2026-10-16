import { describe, expect, it } from 'vitest';
import { defaultDueDate, defaultDueRuleOf, describeDefaultDue } from './default-due';

// 2026-10-16 is EDT (UTC-4): 15:00 New York is 19:00 UTC.
const afternoon = new Date('2026-10-16T19:00:00Z');
// 23:00 New York on the 16th is 03:00 UTC on the 17th.
const lateEvening = new Date('2026-10-17T03:00:00Z');

describe('defaultDueDate', () => {
  it('lands an hours rule on the New York day the deadline falls in', () => {
    expect(defaultDueDate({ every: 2, unit: 'hour' }, afternoon)).toBe('2026-10-16');
    expect(defaultDueDate({ every: 2, unit: 'hour' }, lateEvening)).toBe('2026-10-17');
    expect(defaultDueDate({ every: 48, unit: 'hour' }, afternoon)).toBe('2026-10-18');
  });

  it('counts days and weeks from today in New York, not UTC', () => {
    // Still the 16th in New York though the 17th in UTC.
    expect(defaultDueDate({ every: 2, unit: 'day' }, lateEvening)).toBe('2026-10-18');
    expect(defaultDueDate({ every: 1, unit: 'week' }, afternoon)).toBe('2026-10-23');
    expect(defaultDueDate({ every: 3, unit: 'week' }, new Date('2026-12-20T17:00:00Z'))).toBe(
      '2027-01-10'
    );
  });

  it('clamps a months rule to the length of the month, as Postgres does', () => {
    expect(defaultDueDate({ every: 1, unit: 'month' }, afternoon)).toBe('2026-11-16');
    expect(defaultDueDate({ every: 1, unit: 'month' }, new Date('2027-01-31T17:00:00Z'))).toBe(
      '2027-02-28'
    );
    expect(defaultDueDate({ every: 1, unit: 'month' }, new Date('2027-04-30T17:00:00Z'))).toBe(
      '2027-05-30'
    );
  });
});

describe('defaultDueRuleOf', () => {
  it('reads both halves or neither', () => {
    expect(defaultDueRuleOf({ default_due_every: 2, default_due_unit: 'hour' })).toEqual({
      every: 2,
      unit: 'hour',
    });
    expect(defaultDueRuleOf({ default_due_every: null, default_due_unit: null })).toBeNull();
  });
});

describe('describeDefaultDue', () => {
  it('says one unit or several', () => {
    expect(describeDefaultDue({ every: 1, unit: 'week' })).toBe('1 week');
    expect(describeDefaultDue({ every: 2, unit: 'hour' })).toBe('2 hours');
  });
});
