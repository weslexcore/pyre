import { describe, expect, it } from 'vitest';
import { searchInventory } from './search';
import type { InventoryRow } from './types';

function row(name: string, overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    id: name.toLowerCase(),
    name,
    category: null,
    unit_cost_cents: null,
    vendor: null,
    how_to_order: null,
    count_instructions: null,
    count_every_days: null,
    last_counted_at: null,
    last_counted_by: null,
    in_stock: 10,
    reorder_at: null,
    created_by: 'a@pyre.test',
    created_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-01T12:00:00Z',
    ...overrides,
  };
}

const NOW = new Date('2026-10-26T14:00:00Z');

describe('searchInventory', () => {
  const items = [
    row('Bath towels', { vendor: 'Uline' }),
    row('Towel hooks'),
    row('Test strips', { vendor: 'Towel Depot', in_stock: 2, reorder_at: 5, count_every_days: 7 }),
    row('Propane', { category: 'Fuel' }),
  ];

  it('ranks name prefix, then name, then vendor matches', () => {
    const hits = searchInventory(items, 'towel', { max: 10, now: NOW });
    expect(hits.map((h) => h.name)).toEqual(['Towel hooks', 'Bath towels', 'Test strips']);
  });

  it('carries stock, low, and due', () => {
    const [hit] = searchInventory(items, 'strips', { max: 10, now: NOW });
    expect(hit).toEqual({
      id: 'test strips',
      name: 'Test strips',
      vendor: 'Towel Depot',
      category: '',
      inStock: 2,
      low: true,
      due: true,
    });
  });

  it('matches a category', () => {
    expect(searchInventory(items, 'fuel', { max: 10, now: NOW }).map((h) => h.name)).toEqual([
      'Propane',
    ]);
  });

  it('caps the results and ignores a blank term', () => {
    expect(searchInventory(items, 'towel', { max: 1, now: NOW })).toHaveLength(1);
    expect(searchInventory(items, '  ', { max: 10, now: NOW })).toEqual([]);
  });
});
