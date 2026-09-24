import { describe, expect, it } from 'vitest';
import { parseShiftPrefs } from './shift-prefs';

const none = {
  target_hours_per_week: null,
  min_shifts_per_week: null,
  preferred_shifts_per_week: null,
  max_shifts_per_week: null,
};

describe('parseShiftPrefs', () => {
  it('maps body keys to columns, and null clears', () => {
    expect(
      parseShiftPrefs(
        { targetHours: 16.04, minShifts: 2, preferredShifts: 3, maxShifts: null },
        { ...none, max_shifts_per_week: 4 }
      )
    ).toEqual({
      target_hours_per_week: 16,
      min_shifts_per_week: 2,
      preferred_shifts_per_week: 3,
      max_shifts_per_week: null,
    });
  });

  it('only touches the keys the body carries', () => {
    expect(parseShiftPrefs({ maxShifts: 5 }, none)).toEqual({ max_shifts_per_week: 5 });
    expect(parseShiftPrefs({}, none)).toEqual({});
  });

  it('rejects out-of-range values', () => {
    expect(parseShiftPrefs({ targetHours: 0 }, none)).toHaveProperty('error');
    expect(parseShiftPrefs({ targetHours: 200 }, none)).toHaveProperty('error');
    expect(parseShiftPrefs({ minShifts: -1 }, none)).toHaveProperty('error');
    expect(parseShiftPrefs({ minShifts: 0 }, none)).toEqual({ min_shifts_per_week: 0 });
    expect(parseShiftPrefs({ preferredShifts: 0 }, none)).toHaveProperty('error');
    expect(parseShiftPrefs({ maxShifts: 15 }, none)).toHaveProperty('error');
    expect(parseShiftPrefs({ maxShifts: 2.5 }, none)).toHaveProperty('error');
  });

  it('checks ordering against the saved row', () => {
    const saved = { ...none, min_shifts_per_week: 3, max_shifts_per_week: 5 };
    expect(parseShiftPrefs({ preferredShifts: 6 }, saved)).toHaveProperty('error');
    expect(parseShiftPrefs({ preferredShifts: 2 }, saved)).toHaveProperty('error');
    expect(parseShiftPrefs({ preferredShifts: 4 }, saved)).toEqual({
      preferred_shifts_per_week: 4,
    });
    // Clearing the bound that was in the way lets the edit through.
    expect(parseShiftPrefs({ maxShifts: null, preferredShifts: 6 }, saved)).toEqual({
      max_shifts_per_week: null,
      preferred_shifts_per_week: 6,
    });
  });
});
