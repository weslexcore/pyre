import { describe, expect, it } from 'vitest';
import {
  compareItems,
  formatUnits,
  groupStockByArea,
  groupStockByCategory,
  isLowStock,
  lotDescription,
  lotsToUnits,
  movementBucket,
  parseQuantity,
  parseSignedQuantity,
  signedQuantity,
  suggestedLots,
  totalsByItem,
} from './rules';
import type {
  InventoryAreaRow,
  InventoryCategoryRow,
  InventoryItemRow,
  InventorySpotRow,
} from './types';

const area = (id: string, name: string, sort_order: number, active = true): InventoryAreaRow => ({
  id,
  name,
  description: null,
  sort_order,
  count_every_days: null,
  active,
  created_by: 'a@x',
  created_at: '',
  updated_at: '',
});

const item = (
  id: string,
  name: string,
  over: Partial<InventoryItemRow> = {}
): InventoryItemRow => ({
  id,
  name,
  kind: 'operational',
  category_id: null,
  unit: 'towel',
  lot_size: 12,
  lot_label: 'case',
  reorder_level: 10,
  reorder_target: 36,
  unit_cost_cents: 250,
  vendor: null,
  vendor_url: null,
  notes: null,
  product_id: null,
  variant: null,
  variant_order: 0,
  active: true,
  created_by: 'a@x',
  created_at: '',
  updated_at: '',
  ...over,
});

const spot = (item_id: string, area_id: string, sort_order = 0): InventorySpotRow => ({
  id: `${item_id}-${area_id}`,
  item_id,
  area_id,
  sort_order,
  par_level: null,
  created_at: '',
});

describe('parseQuantity', () => {
  it('accepts positive numbers and numeric strings with up to two decimals', () => {
    expect(parseQuantity(3)).toBe(3);
    expect(parseQuantity('2.5')).toBe(2.5);
    expect(parseQuantity(0.25)).toBe(0.25);
  });

  it('rejects zero, negatives, junk, and over-precise values', () => {
    for (const bad of [0, -1, 'abc', '', null, undefined, Number.NaN, 0.333, 1_000_000]) {
      expect(parseQuantity(bad)).toBeNull();
    }
  });
});

describe('parseSignedQuantity', () => {
  it('keeps the sign and rejects zero', () => {
    expect(parseSignedQuantity(-4)).toBe(-4);
    expect(parseSignedQuantity('3')).toBe(3);
    expect(parseSignedQuantity(0)).toBeNull();
  });
});

describe('signedQuantity', () => {
  it('takes stock out for use and waste, puts it in for receive and initial', () => {
    expect(signedQuantity('use', 2)).toBe(-2);
    expect(signedQuantity('waste', 1)).toBe(-1);
    expect(signedQuantity('receive', 24)).toBe(24);
    expect(signedQuantity('initial', 5)).toBe(5);
  });
});

describe('lots', () => {
  it('converts lots to units', () => {
    expect(lotsToUnits(2, 12)).toBe(24);
    expect(lotsToUnits(1.5, 4)).toBe(6);
  });

  it('describes a lot, or nothing for single units', () => {
    expect(lotDescription({ lot_size: 12, lot_label: 'case' })).toBe('case of 12');
    expect(lotDescription({ lot_size: 6, lot_label: null })).toBe('lot of 6');
    expect(lotDescription({ lot_size: 1, lot_label: null })).toBe('');
  });

  it('pluralises units', () => {
    expect(formatUnits(1, 'towel')).toBe('1 towel');
    expect(formatUnits(3, 'towel')).toBe('3 towels');
    expect(formatUnits(3, 'gloves')).toBe('3 gloves');
  });
});

describe('low stock and re-order suggestion', () => {
  const towels = item('t', 'Towels');

  it('is low at or below the level, never when there is no level', () => {
    expect(isLowStock(towels, 10)).toBe(true);
    expect(isLowStock(towels, 11)).toBe(false);
    expect(isLowStock(item('x', 'X', { reorder_level: null }), 0)).toBe(false);
  });

  it('rounds the gap to the fill-to level up to whole lots', () => {
    expect(suggestedLots(towels, 10)).toBe(3); // need 26 → 3 cases of 12
    expect(suggestedLots(towels, 0)).toBe(3); // need 36 → 3 cases
    expect(suggestedLots(towels, 40)).toBe(0);
  });

  it('suggests at least one lot for a low item even with no fill-to gap', () => {
    const flat = item('f', 'Flat', { reorder_level: 10, reorder_target: null });
    expect(suggestedLots(flat, 10)).toBe(1);
    expect(suggestedLots(item('n', 'None', { reorder_level: null, reorder_target: null }), 0)).toBe(
      null
    );
  });
});

describe('movementBucket', () => {
  it('keeps usage apart from explained and unexplained loss', () => {
    expect(movementBucket('use', -2)).toBe('usage');
    expect(movementBucket('waste', -1)).toBe('explained_loss');
    expect(movementBucket('count_adjust', -3)).toBe('unexplained_loss');
    expect(movementBucket('count_adjust', 2)).toBe('found');
    expect(movementBucket('correction', -5)).toBe('neutral');
    expect(movementBucket('transfer', -5)).toBe('neutral');
  });
});

describe('groupStockByArea', () => {
  const areas = [
    area('b', 'Front desk', 2),
    area('a', 'Back closet', 1),
    area('z', 'Old', 0, false),
  ];
  const items = [item('t', 'Towels'), item('s', 'Soap'), item('r', 'Retired', { active: false })];
  const spots = [
    spot('t', 'a', 2),
    spot('s', 'a', 1),
    spot('t', 'b'),
    spot('r', 'a'),
    spot('t', 'z'),
  ];
  const stock = [
    { item_id: 't', area_id: 'a', quantity: 6, updated_at: '' },
    { item_id: 't', area_id: 'b', quantity: 3, updated_at: '' },
  ];

  it('orders active areas by walk order and items by shelf order', () => {
    const grouped = groupStockByArea({ areas, items, spots, stock });
    expect(grouped.map((g) => g.area.name)).toEqual(['Back closet', 'Front desk']);
    expect(grouped[0].lines.map((l) => l.item.name)).toEqual(['Soap', 'Towels']);
  });

  it('shows per-spot quantity with the cross-spot total and low flag', () => {
    const [closet, desk] = groupStockByArea({ areas, items, spots, stock });
    const towelsInCloset = closet.lines.find((l) => l.item.id === 't');
    expect(towelsInCloset).toMatchObject({ quantity: 6, total: 9, low: true });
    expect(desk.lines[0]).toMatchObject({ quantity: 3, total: 9 });
    expect(closet.lines.find((l) => l.item.id === 's')?.quantity).toBe(0);
  });

  it('totals stock per item', () => {
    expect(totalsByItem(stock).get('t')).toBe(9);
  });
});

describe('groupStockByCategory', () => {
  const category = (
    id: string,
    name: string,
    sort_order: number,
    active = true
  ): InventoryCategoryRow => ({
    id,
    name,
    sort_order,
    active,
    created_by: 'a@x',
    created_at: '',
    updated_at: '',
  });
  const areas = [area('b', 'Front desk', 2), area('a', 'Back closet', 1)];
  const categories = [
    category('lin', 'Linens', 2),
    category('cln', 'Cleaning', 1),
    category('old', 'Old stuff', 3, false),
    category('nil', 'Empty', 0),
  ];
  const items = [
    item('t', 'Towels', { category_id: 'lin' }),
    item('r', 'Robes', { category_id: 'lin', reorder_level: null }),
    item('s', 'Spray', { category_id: 'cln', reorder_level: null }),
    item('x', 'Gone', { category_id: 'old', reorder_level: null }),
    item('u', 'Unsorted', { reorder_level: null }),
    item('d', 'Retired', { category_id: 'cln', active: false }),
  ];
  const spots = [spot('t', 'b'), spot('t', 'a'), spot('s', 'a')];
  const stock = [
    { item_id: 't', area_id: 'a', quantity: 6, updated_at: '' },
    { item_id: 't', area_id: 'b', quantity: 3, updated_at: '' },
    { item_id: 's', area_id: 'a', quantity: 2, updated_at: '' },
  ];
  const grouped = groupStockByCategory({ areas, categories, products: [], items, spots, stock });
  const names = (g: (typeof grouped)[number]) =>
    g.entries.map((e) => (e.kind === 'item' ? e.item.name : e.product.name));

  it('orders categories by display order, skips empty ones, puts uncategorised last', () => {
    expect(grouped.map((g) => g.category?.name ?? null)).toEqual([
      'Cleaning',
      'Linens',
      'Old stuff',
      null,
    ]);
  });

  it('lists active items by name with their total and every spot in walk order', () => {
    const linens = grouped[1];
    expect(names(linens)).toEqual(['Robes', 'Towels']);
    const [robes, towels] = linens.entries;
    expect(towels).toMatchObject({ kind: 'item', total: 9, low: true });
    if (towels.kind !== 'item' || robes.kind !== 'item') throw new Error('expected items');
    expect(towels.lines.map((l) => [l.spot.area_id, l.quantity])).toEqual([
      ['a', 6],
      ['b', 3],
    ]);
    expect(robes.lines).toEqual([]);
    expect(names(grouped[0])).toEqual(['Spray']);
  });

  it("gathers a product's variants under it, in their set order, with a combined total", () => {
    const tee = {
      id: 'p',
      name: 'Pyre Tee',
      category_id: 'lin',
      active: true,
      created_by: 'a@x',
      created_at: '',
      updated_at: '',
    };
    const variant = (id: string, label: string, order: number, over = {}) =>
      item(id, `Pyre Tee — ${label}`, {
        category_id: 'lin',
        product_id: 'p',
        variant: label,
        variant_order: order,
        reorder_level: 2,
        ...over,
      });
    const withTees = groupStockByCategory({
      areas,
      categories,
      products: [tee],
      items: [
        ...items,
        variant('vl', 'L', 3),
        variant('vs', 'S', 1),
        variant('vm', 'M', 2),
        variant('vx', 'XL', 4, { active: false }),
      ],
      spots: [...spots, spot('vs', 'a'), spot('vm', 'a'), spot('vl', 'b')],
      stock: [
        ...stock,
        { item_id: 'vs', area_id: 'a', quantity: 5, updated_at: '' },
        { item_id: 'vm', area_id: 'a', quantity: 1, updated_at: '' },
        { item_id: 'vl', area_id: 'b', quantity: 4, updated_at: '' },
      ],
    });
    const linens = withTees.find((g) => g.category?.id === 'lin');
    if (!linens) throw new Error('no linens');
    expect(names(linens)).toEqual(['Pyre Tee', 'Robes', 'Towels']);
    const product = linens.entries[0];
    if (product.kind !== 'product') throw new Error('expected a product');
    expect(product.variants.map((v) => v.item.variant)).toEqual(['S', 'M', 'L']);
    expect(product).toMatchObject({ total: 10, low: true });
  });
});

describe('compareItems', () => {
  it("keeps one product's variants in their set order and sorts the rest by name", () => {
    const m = item('m', 'Tee — M', { product_id: 'p', variant: 'M', variant_order: 2 });
    const xl = item('xl', 'Tee — XL', { product_id: 'p', variant: 'XL', variant_order: 4 });
    const l = item('l', 'Tee — L', { product_id: 'p', variant: 'L', variant_order: 3 });
    const soap = item('s', 'Soap');
    expect([xl, soap, l, m].sort(compareItems).map((i) => i.name)).toEqual([
      'Soap',
      'Tee — M',
      'Tee — L',
      'Tee — XL',
    ]);
  });
});
