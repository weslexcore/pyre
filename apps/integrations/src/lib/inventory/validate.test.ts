import { describe, expect, it } from 'vitest';
import { dollarsToCents, normalizeArea, normalizeItem } from './validate';

describe('normalizeArea', () => {
  it('requires a name on create and maps fields to columns', () => {
    expect(normalizeArea({})).toMatchObject({ ok: false });
    expect(
      normalizeArea({ name: '  Back closet ', sortOrder: 2, countEveryDays: 7, description: '' })
    ).toEqual({
      ok: true,
      value: { name: 'Back closet', sort_order: 2, count_every_days: 7, description: null },
    });
  });

  it('patches only what is sent, and can clear the count schedule', () => {
    expect(normalizeArea({ countEveryDays: null }, { partial: true })).toEqual({
      ok: true,
      value: { count_every_days: null },
    });
    expect(normalizeArea({ countEveryDays: 0 }, { partial: true }).ok).toBe(false);
  });
});

describe('normalizeItem', () => {
  it('fills defaults for unit and lot size on create', () => {
    const result = normalizeItem({ name: 'Towels' });
    expect(result).toEqual({ ok: true, value: { name: 'Towels', unit: 'each', lot_size: 1 } });
  });

  it('maps re-order settings and cost', () => {
    const result = normalizeItem({
      name: 'Towels',
      unit: 'towel',
      lotSize: '12',
      lotLabel: 'case',
      reorderLevel: 10,
      reorderTarget: 36,
      unitCost: '2.50',
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        lot_size: 12,
        lot_label: 'case',
        reorder_level: 10,
        reorder_target: 36,
        unit_cost_cents: 250,
      },
    });
  });

  it('rejects a fill-to level below the re-order level, bad lots and urls', () => {
    expect(normalizeItem({ name: 'X', reorderLevel: 10, reorderTarget: 5 }).ok).toBe(false);
    expect(normalizeItem({ name: 'X', lotSize: 0 }).ok).toBe(false);
    expect(normalizeItem({ name: 'X', vendorUrl: 'javascript:alert(1)' }).ok).toBe(false);
  });

  it('patches without requiring name', () => {
    expect(normalizeItem({ active: false }, { partial: true })).toEqual({
      ok: true,
      value: { active: false },
    });
  });
});

describe('dollarsToCents', () => {
  it('parses dollars and clears on empty', () => {
    expect(dollarsToCents('$3.10')).toBe(310);
    expect(dollarsToCents('')).toBeNull();
    expect(dollarsToCents('-1')).toBeUndefined();
  });
});
