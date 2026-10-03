import { describe, expect, it } from 'vitest';
import { searchInventory } from './search';
import type { InventoryAreaRow, InventoryItemRow } from './types';

const now = '2026-10-02T00:00:00Z';
const item = (
  id: string,
  name: string,
  over: Partial<InventoryItemRow> = {}
): InventoryItemRow => ({
  id,
  name,
  kind: 'operational',
  category_id: null,
  unit: 'each',
  lot_size: 1,
  lot_label: null,
  reorder_level: null,
  reorder_target: null,
  unit_cost_cents: null,
  vendor: null,
  vendor_url: null,
  notes: null,
  product_id: null,
  variant: null,
  variant_order: 0,
  active: true,
  created_by: 'a@x',
  created_at: now,
  updated_at: now,
  ...over,
});
const area = (id: string, name: string, sort_order: number, active = true): InventoryAreaRow => ({
  id,
  name,
  description: null,
  sort_order,
  count_every_days: null,
  active,
  created_by: 'a@x',
  created_at: now,
  updated_at: now,
});

const data = {
  categories: [
    {
      id: 'c1',
      name: 'Linens',
      sort_order: 1,
      active: true,
      created_by: 'x',
      created_at: now,
      updated_at: now,
    },
  ],
  areas: [
    area('a1', 'Front desk', 2),
    area('a2', 'Back closet', 1),
    area('a3', 'Old shelf', 3, false),
  ],
  items: [
    item('i1', 'Bath towels', { category_id: 'c1', unit: 'towel', reorder_level: 10 }),
    item('i2', 'Hand towels', { category_id: 'c1', unit: 'towel' }),
    item('i3', 'Towel hooks'),
    item('i4', 'Retired towels', { active: false }),
    item('i5', 'Sheets', { category_id: 'c1', vendor: 'Uline' }),
  ],
  spots: [
    { id: 's1', item_id: 'i1', area_id: 'a1', sort_order: 0, par_level: null, created_at: now },
    { id: 's2', item_id: 'i1', area_id: 'a2', sort_order: 0, par_level: null, created_at: now },
    { id: 's3', item_id: 'i1', area_id: 'a3', sort_order: 0, par_level: null, created_at: now },
  ],
  stock: [
    { item_id: 'i1', area_id: 'a1', quantity: 4, updated_at: now },
    { item_id: 'i1', area_id: 'a2', quantity: 3, updated_at: now },
  ],
};

describe('searchInventory', () => {
  it('ranks name-prefix matches, then name matches, then category/vendor/unit, skipping retired items', () => {
    const hits = searchInventory(data, 'towel', { max: 10, editable: true });
    expect(hits.map((h) => h.name)).toEqual(['Towel hooks', 'Bath towels', 'Hand towels']);
  });

  it('matches on category and vendor', () => {
    expect(searchInventory(data, 'linens', { max: 10, editable: false }).map((h) => h.id)).toEqual([
      'i1',
      'i2',
      'i5',
    ]);
    expect(searchInventory(data, 'uline', { max: 10, editable: false }).map((h) => h.id)).toEqual([
      'i5',
    ]);
  });

  it('reports total on hand, low stock, active areas in walk order, and who may edit', () => {
    const [bath] = searchInventory(data, 'bath', { max: 10, editable: false });
    expect(bath).toEqual({
      id: 'i1',
      name: 'Bath towels',
      category: 'Linens',
      unit: 'towel',
      onHand: 7,
      low: true,
      areas: ['Back closet', 'Front desk'],
      editable: false,
    });
  });

  it('caps the results and ignores blank terms', () => {
    expect(searchInventory(data, 'towel', { max: 2, editable: true })).toHaveLength(2);
    expect(searchInventory(data, '  ', { max: 10, editable: true })).toEqual([]);
  });
});
