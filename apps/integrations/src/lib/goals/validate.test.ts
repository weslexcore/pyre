import { describe, expect, it } from 'vitest';
import {
  numberOf,
  parseGoalCreate,
  parseGoalPatch,
  parseKpiCreate,
  parseKpiMeasure,
  parseKpiPatch,
} from './validate';

const UUID = '3f1b8a2c-7d4e-4a1b-9c2d-5e6f7a8b9c0d';

function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}

function error(result: { ok: boolean; error?: string }): string {
  if (result.ok) throw new Error('expected a failure');
  return result.error ?? '';
}

describe('parseGoalCreate', () => {
  it('trims and defaults the rest', () => {
    expect(value(parseGoalCreate({ title: '  Train the staff  ' }))).toEqual({
      title: 'Train the staff',
      description_md: '',
      status: 'planned',
      owner_email: null,
      area: null,
      target_date: null,
    });
  });

  it('takes the whole shape', () => {
    const goal = value(
      parseGoalCreate({
        title: 'Tighter rental definitions',
        descriptionMd: '  what good looks like  ',
        status: 'active',
        ownerEmail: '  Julien@PyreSauna.com ',
        area: 'Operations',
        targetDate: '2026-12-31',
      })
    );
    expect(goal).toMatchObject({
      description_md: 'what good looks like',
      status: 'active',
      owner_email: 'julien@pyresauna.com',
      area: 'Operations',
      target_date: '2026-12-31',
    });
  });

  it('rejects a blank or oversized title', () => {
    expect(error(parseGoalCreate({ title: '   ' }))).toMatch(/title/);
    expect(error(parseGoalCreate({ title: 'x'.repeat(201) }))).toMatch(/title/);
  });

  it('refuses to create a goal already completed', () => {
    expect(error(parseGoalCreate({ title: 'a', status: 'completed' }))).toMatch(/completed/);
  });

  it('rejects a date the calendar does not have', () => {
    expect(error(parseGoalCreate({ title: 'a', targetDate: '2026-02-31' }))).toMatch(/targetDate/);
    expect(error(parseGoalCreate({ title: 'a', targetDate: '31/12/2026' }))).toMatch(/targetDate/);
  });

  it('rejects an area nobody uses', () => {
    expect(error(parseGoalCreate({ title: 'a', area: 'Wizardry' }))).toMatch(/area/);
  });

  it('ignores a parent: goals no longer nest', () => {
    expect('parent_id' in value(parseGoalCreate({ title: 'a', parentId: UUID }))).toBe(false);
  });
});

describe('parseGoalPatch', () => {
  it('touches only what was sent', () => {
    expect(value(parseGoalPatch({ title: 'New title' }))).toEqual({ title: 'New title' });
  });

  it('tells null apart from absent', () => {
    // Absent leaves the date alone; null clears it.
    expect('target_date' in value(parseGoalPatch({ title: 'a' }))).toBe(false);
    expect(value(parseGoalPatch({ targetDate: null })).target_date).toBeNull();
    expect(value(parseGoalPatch({ targetDate: '' })).target_date).toBeNull();
    expect(value(parseGoalPatch({ targetDate: '2026-12-31' })).target_date).toBe('2026-12-31');
  });

  it('clears a date, an owner, an area, and a note with null or blank', () => {
    expect(value(parseGoalPatch({ targetDate: null })).target_date).toBeNull();
    expect(value(parseGoalPatch({ ownerEmail: '' })).owner_email).toBeNull();
    expect(value(parseGoalPatch({ area: null })).area).toBeNull();
    expect(value(parseGoalPatch({ completionNote: '  ' })).completion_note).toBeNull();
  });

  it('rejects an empty patch', () => {
    expect(error(parseGoalPatch({}))).toMatch(/Nothing to change/);
  });

  it('rejects a fractional sort order', () => {
    expect(error(parseGoalPatch({ sortOrder: 1.5 }))).toMatch(/whole number/);
    expect(value(parseGoalPatch({ sortOrder: '30' })).sort_order).toBe(30);
  });
});

describe('numberOf', () => {
  it('accepts what a number input hands back, and nothing else', () => {
    expect(numberOf(4)).toBe(4);
    expect(numberOf('4.5')).toBe(4.5);
    expect(numberOf(' -2 ')).toBe(-2);
    // The coercion mistake that would quietly corrupt a KPI.
    expect(numberOf('')).toBeUndefined();
    expect(numberOf('four')).toBeUndefined();
    expect(numberOf(null)).toBeUndefined();
    expect(numberOf(Number.NaN)).toBeUndefined();
    expect(numberOf(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('parseKpiCreate', () => {
  const base = { goalId: UUID, name: 'Consecutive weeks', direction: 'at_least', targetValue: 4 };

  it('takes the whole shape', () => {
    expect(value(parseKpiCreate({ ...base, unit: 'weeks', startValue: '1' }))).toEqual({
      goal_id: UUID,
      name: 'Consecutive weeks',
      unit: 'weeks',
      direction: 'at_least',
      start_value: 1,
      target_value: 4,
    });
  });

  it('defaults a missing start to null rather than zero', () => {
    expect(value(parseKpiCreate(base)).start_value).toBeNull();
    expect(value(parseKpiCreate({ ...base, startValue: '' })).start_value).toBeNull();
  });

  it('requires a goal, a name, a direction, and a target', () => {
    expect(error(parseKpiCreate({ ...base, goalId: 'x' }))).toMatch(/goalId/);
    expect(error(parseKpiCreate({ ...base, name: '  ' }))).toMatch(/name/);
    expect(error(parseKpiCreate({ ...base, direction: 'more' }))).toMatch(/direction/);
    expect(error(parseKpiCreate({ ...base, targetValue: 'lots' }))).toMatch(/targetValue/);
  });

  it('accepts zero as a target', () => {
    expect(
      value(parseKpiCreate({ ...base, direction: 'at_most', targetValue: 0 })).target_value
    ).toBe(0);
  });
});

describe('parseKpiPatch', () => {
  it('clears a measurement with null', () => {
    expect(value(parseKpiPatch({ currentValue: null })).current_value).toBeNull();
    expect(value(parseKpiPatch({ currentValue: 0 })).current_value).toBe(0);
  });

  it('rejects an empty patch and a bad number', () => {
    expect(error(parseKpiPatch({}))).toMatch(/Nothing to change/);
    expect(error(parseKpiPatch({ currentValue: 'three' }))).toMatch(/currentValue/);
  });
});

describe('parseKpiMeasure', () => {
  it('takes one number and nothing else', () => {
    expect(value(parseKpiMeasure({ currentValue: 3 }))).toBe(3);
    expect(value(parseKpiMeasure({ currentValue: null }))).toBeNull();
    expect(error(parseKpiMeasure({}))).toMatch(/required/);
    expect(error(parseKpiMeasure({ currentValue: 'three' }))).toMatch(/number/);
  });
});
