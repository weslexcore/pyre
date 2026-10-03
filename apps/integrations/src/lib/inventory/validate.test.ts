import { describe, expect, it } from 'vitest';
import {
  dollarsToCents,
  normalizeArea,
  normalizeCategory,
  normalizeItem,
  normalizeProduct,
  normalizeUnit,
  parseVariants,
} from './validate';

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

const UNIT = '00000000-0000-4000-8000-0000000000a1';
const CASE = '00000000-0000-4000-8000-0000000000c5';

describe('normalizeItem', () => {
  it('needs a unit picked on create, and defaults the lot size', () => {
    expect(normalizeItem({ name: 'Towels' })).toMatchObject({ ok: false, error: 'Pick a unit' });
    expect(normalizeItem({ name: 'Towels', unit: 'towel' }).ok).toBe(false);
    expect(normalizeItem({ name: 'Towels', unitId: UNIT })).toEqual({
      ok: true,
      value: { name: 'Towels', unit_id: UNIT, lot_size: 1 },
    });
  });

  it('takes a lot unit by id and clears it on empty', () => {
    expect(normalizeItem({ lotUnitId: CASE }, { partial: true })).toEqual({
      ok: true,
      value: { lot_unit_id: CASE },
    });
    expect(normalizeItem({ lotUnitId: '' }, { partial: true })).toEqual({
      ok: true,
      value: { lot_unit_id: null },
    });
    expect(normalizeItem({ lotUnitId: 'case' }, { partial: true }).ok).toBe(false);
  });

  it('maps re-order settings and cost', () => {
    const result = normalizeItem({
      name: 'Towels',
      unitId: UNIT,
      lotSize: '12',
      lotUnitId: CASE,
      reorderLevel: 10,
      reorderTarget: 36,
      unitCost: '2.50',
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        lot_size: 12,
        lot_unit_id: CASE,
        reorder_level: 10,
        reorder_target: 36,
        unit_cost_cents: 250,
      },
    });
  });

  it('rejects a fill-to level below the re-order level, bad lots and urls', () => {
    const base = { name: 'X', unitId: UNIT };
    expect(normalizeItem(base).ok).toBe(true);
    expect(normalizeItem({ ...base, reorderLevel: 10, reorderTarget: 5 }).ok).toBe(false);
    expect(normalizeItem({ ...base, lotSize: 0 }).ok).toBe(false);
    expect(normalizeItem({ ...base, vendorUrl: 'javascript:alert(1)' }).ok).toBe(false);
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

describe('normalizeCategory', () => {
  it('requires a name and maps fields', () => {
    expect(normalizeCategory({}).ok).toBe(false);
    expect(normalizeCategory({ name: ' Linens ', sortOrder: 3 })).toEqual({
      ok: true,
      value: { name: 'Linens', sort_order: 3 },
    });
  });
});

describe('normalizeItem category', () => {
  it('takes a category id, clears on empty, rejects junk', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(normalizeItem({ categoryId: id }, { partial: true })).toEqual({
      ok: true,
      value: { category_id: id },
    });
    expect(normalizeItem({ categoryId: '' }, { partial: true })).toEqual({
      ok: true,
      value: { category_id: null },
    });
    expect(normalizeItem({ categoryId: 'Linens' }, { partial: true }).ok).toBe(false);
  });
});

describe('normalizeProduct', () => {
  it('requires a name on create and caps it so a variant name still fits', () => {
    expect(normalizeProduct({ name: ' Pyre Tee ', categoryId: '' })).toEqual({
      ok: true,
      value: { name: 'Pyre Tee', category_id: null },
    });
    expect(normalizeProduct({ name: 'x'.repeat(61) }).ok).toBe(false);
    expect(normalizeProduct({ active: false }, { partial: true })).toEqual({
      ok: true,
      value: { active: false },
    });
  });
});

describe('normalizeItem variants', () => {
  it('takes a variant label and its position', () => {
    expect(normalizeItem({ variant: ' XL ', variantOrder: 4 }, { partial: true })).toEqual({
      ok: true,
      value: { variant: 'XL', variant_order: 4 },
    });
    expect(normalizeItem({ variant: '' }, { partial: true }).ok).toBe(false);
  });
});

describe('parseVariants', () => {
  it('splits a comma list, trims, and drops blanks and repeats in order', () => {
    expect(parseVariants('S, M, , m, L,XL')).toEqual(['S', 'M', 'L', 'XL']);
    expect(parseVariants(['Lemon', ' Lime '])).toEqual(['Lemon', 'Lime']);
  });

  it('refuses none, too many, too long, and non-text', () => {
    expect(typeof parseVariants(' , ')).toBe('string');
    expect(typeof parseVariants(Array.from({ length: 31 }, (_, i) => `v${i}`))).toBe('string');
    expect(typeof parseVariants(['x'.repeat(41)])).toBe('string');
    expect(typeof parseVariants([1, 2])).toBe('string');
  });
});

describe('normalizeUnit', () => {
  it('needs both spellings on create and patches either', () => {
    expect(normalizeUnit({ name: 'box' }).ok).toBe(false);
    expect(normalizeUnit({ name: ' box ', plural: 'boxes', sortOrder: 2 })).toEqual({
      ok: true,
      value: { name: 'box', plural: 'boxes', sort_order: 2 },
    });
    expect(normalizeUnit({ plural: 'each' }, { partial: true })).toEqual({
      ok: true,
      value: { plural: 'each' },
    });
    expect(normalizeUnit({ plural: '' }, { partial: true }).ok).toBe(false);
  });
});
