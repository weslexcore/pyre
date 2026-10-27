import { describe, expect, it } from 'vitest';
import { changedFields, diffItems, formatFieldValue, mergeChanges, stockDelta } from './changes';

describe('diffItems', () => {
  it('lists each field that changed, before and after', () => {
    expect(
      diffItems(
        { name: 'Towels', unit_cost_cents: 450, vendor: 'Uline', in_stock: 10 },
        { name: 'Towels', unit_cost_cents: 500, vendor: null, in_stock: 10 }
      )
    ).toEqual({ unit_cost_cents: { from: 450, to: 500 }, vendor: { from: 'Uline', to: null } });
  });

  it('treats a new item as changed from nothing', () => {
    expect(diffItems(null, { name: 'Soap', vendor: null, in_stock: 3 })).toEqual({
      name: { from: null, to: 'Soap' },
      in_stock: { from: null, to: 3 },
    });
  });

  it('is empty for a count that found the same number', () => {
    expect(diffItems({ in_stock: 4 }, { in_stock: 4 })).toEqual({});
  });
});

describe('mergeChanges', () => {
  it('keeps the first before and the latest after', () => {
    expect(
      mergeChanges(
        { in_stock: { from: 10, to: 1 }, vendor: { from: null, to: 'U' } },
        { in_stock: { from: 1, to: 8 }, vendor: { from: 'U', to: 'Uline' } }
      )
    ).toEqual({ in_stock: { from: 10, to: 8 }, vendor: { from: null, to: 'Uline' } });
  });

  it('drops a field that ended where it started', () => {
    expect(
      mergeChanges(
        { in_stock: { from: 10, to: 1 } },
        { in_stock: { from: 1, to: 10 }, name: { from: 'a', to: 'b' } }
      )
    ).toEqual({ name: { from: 'a', to: 'b' } });
  });
});

describe('formatting', () => {
  it('shows values the way the list does', () => {
    expect(formatFieldValue('unit_cost_cents', 450)).toBe('$4.50');
    expect(formatFieldValue('count_every_days', 7)).toBe('Weekly');
    expect(formatFieldValue('in_stock', 2.5)).toBe('2.5');
    expect(formatFieldValue('vendor', null)).toBeNull();
    expect(formatFieldValue('active', false)).toBe('Inactive');
    expect(formatFieldValue('active', true)).toBe('Active');
    expect(formatFieldValue('how_to_order', `https://x.test/${'a'.repeat(100)}`)).toHaveLength(80);
  });

  it('signs a stock change', () => {
    expect(stockDelta({ from: 10, to: 4 })).toBe('−6');
    expect(stockDelta({ from: 4, to: 10 })).toBe('+6');
    expect(stockDelta({ from: null, to: 10 })).toBeNull();
    expect(stockDelta(undefined)).toBeNull();
  });

  it('lists changed fields in a fixed order', () => {
    expect(
      changedFields({
        changes: { vendor: { from: null, to: 'U' }, name: { from: 'a', to: 'b' } },
      }).map((f) => f.label)
    ).toEqual(['Name', 'Vendor']);
  });
});
