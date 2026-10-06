import { describe, expect, it } from 'vitest';
import { DEFAULT_DUE_DAYS, describeDueDays, dueDateFor, parseDueDays } from './priority';

describe('dueDateFor', () => {
  it('counts the grid’s days from the given day', () => {
    expect(dueDateFor('critical', 'high', DEFAULT_DUE_DAYS, '2026-10-06')).toBe('2026-10-06');
    expect(dueDateFor('high', 'medium', DEFAULT_DUE_DAYS, '2026-10-06')).toBe('2026-10-09');
    expect(dueDateFor('low', 'low', DEFAULT_DUE_DAYS, '2026-10-06')).toBe('2026-11-05');
  });

  it('reads a missing half as medium, and neither as no date', () => {
    expect(dueDateFor('high', null, DEFAULT_DUE_DAYS, '2026-10-06')).toBe('2026-10-09');
    expect(dueDateFor(null, 'high', DEFAULT_DUE_DAYS, '2026-10-06')).toBe('2026-10-09');
    expect(dueDateFor(null, null, DEFAULT_DUE_DAYS, '2026-10-06')).toBeNull();
  });

  it('leaves a blank cell undated', () => {
    const grid = { ...DEFAULT_DUE_DAYS, low: { ...DEFAULT_DUE_DAYS.low, low: null } };
    expect(dueDateFor('low', 'low', grid, '2026-10-06')).toBeNull();
  });
});

describe('parseDueDays', () => {
  it('takes the default grid', () => {
    expect(parseDueDays(DEFAULT_DUE_DAYS)).toEqual({ ok: true, value: DEFAULT_DUE_DAYS });
  });

  it('refuses a missing row, a fraction, or a negative', () => {
    const { low: _low, ...missing } = DEFAULT_DUE_DAYS;
    expect(parseDueDays(missing).ok).toBe(false);
    const fraction = { ...DEFAULT_DUE_DAYS, high: { ...DEFAULT_DUE_DAYS.high, low: 1.5 } };
    expect(parseDueDays(fraction).ok).toBe(false);
    const negative = { ...DEFAULT_DUE_DAYS, high: { ...DEFAULT_DUE_DAYS.high, low: -1 } };
    expect(parseDueDays(negative).ok).toBe(false);
    expect(parseDueDays([]).ok).toBe(false);
  });
});

describe('describeDueDays', () => {
  it('says it plainly', () => {
    expect(describeDueDays(null)).toBe('No due date');
    expect(describeDueDays(0)).toBe('Due the same day');
    expect(describeDueDays(1)).toBe('Due in 1 day');
    expect(describeDueDays(7)).toBe('Due in 7 days');
  });
});
