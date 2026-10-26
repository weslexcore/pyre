import { describe, expect, it } from 'vitest';
import {
  formatCents,
  isDue,
  isLow,
  type ListQuery,
  listItems,
  normalizeFields,
  orderLink,
  parseDollars,
  parseQuantity,
  UNCATEGORISED,
} from './rules';
import type { InventoryRow } from './types';

function row(overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    id: overrides.name ?? 'id',
    name: 'Towels',
    category: null,
    unit_cost_cents: null,
    vendor: null,
    how_to_order: null,
    count_every_days: null,
    last_counted_at: null,
    last_counted_by: null,
    in_stock: 0,
    reorder_at: null,
    created_by: 'a@pyre.test',
    created_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-01T12:00:00Z',
    ...overrides,
  };
}

// 2026-10-26 10:00 ET
const NOW = new Date('2026-10-26T14:00:00Z');

describe('isDue', () => {
  it('is never due without a schedule', () => {
    expect(isDue(row(), NOW)).toBe(false);
  });

  it('is due when scheduled and never counted', () => {
    expect(isDue(row({ count_every_days: 7 }), NOW)).toBe(true);
  });

  it('counts studio calendar days, so daily is due again the next morning', () => {
    // 11pm ET the night before
    const lateLastNight = '2026-10-26T03:00:00Z';
    expect(isDue(row({ count_every_days: 1, last_counted_at: lateLastNight }), NOW)).toBe(true);
    // earlier today
    expect(isDue(row({ count_every_days: 1, last_counted_at: '2026-10-26T12:00:00Z' }), NOW)).toBe(
      false
    );
  });

  it('is due once the interval has turned over', () => {
    expect(isDue(row({ count_every_days: 7, last_counted_at: '2026-10-20T14:00:00Z' }), NOW)).toBe(
      false
    );
    expect(isDue(row({ count_every_days: 7, last_counted_at: '2026-10-19T14:00:00Z' }), NOW)).toBe(
      true
    );
  });
});

describe('isLow', () => {
  it('flags at or below the re-order level, never without one', () => {
    expect(isLow(row({ in_stock: 3, reorder_at: 3 }))).toBe(true);
    expect(isLow(row({ in_stock: 4, reorder_at: 3 }))).toBe(false);
    expect(isLow(row({ in_stock: 0 }))).toBe(false);
  });
});

describe('parsing', () => {
  it('reads quantities and rejects junk', () => {
    expect(parseQuantity('12')).toBe(12);
    expect(parseQuantity('2.5')).toBe(2.5);
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
  });

  it('reads prices as cents', () => {
    expect(parseDollars('$4.50')).toBe(450);
    expect(parseDollars('4')).toBe(400);
    expect(parseDollars('1,200.5')).toBe(120050);
    expect(parseDollars('.99')).toBe(99);
    expect(parseDollars('4.999')).toBeNull();
    expect(parseDollars('free')).toBeNull();
    expect(formatCents(450)).toBe('$4.50');
    expect(formatCents(null)).toBe('');
  });

  it('links how-to-order when it starts with a URL', () => {
    expect(orderLink('https://amazon.com/dp/123')).toBe('https://amazon.com/dp/123');
    expect(orderLink('https://uline.com/x ask for the 12-pack')).toBe('https://uline.com/x');
    expect(orderLink('Call Dan at 555-0100')).toBeNull();
    expect(orderLink(null)).toBeNull();
  });
});

describe('normalizeFields', () => {
  it('requires a name on create and defaults stock to 0', () => {
    expect(normalizeFields({})).toEqual({ ok: false, error: 'Give the item a name' });
    const made = normalizeFields({ name: '  Towels ' });
    expect(made).toMatchObject({ ok: true, value: { name: 'Towels', in_stock: 0, vendor: null } });
  });

  it('checks only the keys a patch sends', () => {
    expect(normalizeFields({ in_stock: 5 }, { partial: true })).toEqual({
      ok: true,
      value: { in_stock: 5 },
    });
    expect(normalizeFields({ reorder_at: null }, { partial: true })).toEqual({
      ok: true,
      value: { reorder_at: null },
    });
  });

  it('rejects bad values', () => {
    expect(normalizeFields({ in_stock: -1 }, { partial: true }).ok).toBe(false);
    expect(normalizeFields({ count_every_days: 0 }, { partial: true }).ok).toBe(false);
    expect(normalizeFields({ unit_cost_cents: 1.5 }, { partial: true }).ok).toBe(false);
    expect(normalizeFields({ vendor: 'x'.repeat(121) }, { partial: true }).ok).toBe(false);
  });
});

describe('listItems', () => {
  const items = [
    row({
      name: 'Towels',
      category: 'Linens',
      vendor: 'Uline',
      in_stock: 40,
      reorder_at: 20,
      count_every_days: 7,
      last_counted_at: '2026-10-25T14:00:00Z',
    }),
    row({
      name: 'Propane',
      category: 'Fuel',
      vendor: 'AmeriGas',
      in_stock: 1,
      reorder_at: 2,
      count_every_days: 1,
    }),
    row({ name: 'Hair ties', in_stock: 100, unit_cost_cents: 5 }),
  ];
  const base: ListQuery = {
    search: '',
    filter: 'all',
    category: '',
    sort: 'name',
    desc: false,
  };
  const names = (q: Partial<ListQuery>) =>
    listItems(items, { ...base, ...q }, NOW).map((i) => i.name);

  it('filters by category, or to the uncategorised', () => {
    expect(names({ category: 'Linens' })).toEqual(['Towels']);
    expect(names({ category: UNCATEGORISED })).toEqual(['Hair ties']);
    expect(names({ search: 'fuel' })).toEqual(['Propane']);
  });

  it('sorts by category with the uncategorised last', () => {
    expect(names({ sort: 'category' })).toEqual(['Propane', 'Towels', 'Hair ties']);
  });

  it('sorts by name either way', () => {
    expect(names({})).toEqual(['Hair ties', 'Propane', 'Towels']);
    expect(names({ desc: true })).toEqual(['Towels', 'Propane', 'Hair ties']);
  });

  it('sorts empty values last in both directions', () => {
    expect(names({ sort: 'vendor' })).toEqual(['Propane', 'Towels', 'Hair ties']);
    expect(names({ sort: 'vendor', desc: true })).toEqual(['Towels', 'Propane', 'Hair ties']);
  });

  it('sorts due items first', () => {
    expect(names({ sort: 'due' })).toEqual(['Propane', 'Towels', 'Hair ties']);
  });

  it('filters by due, re-order, and search', () => {
    expect(names({ filter: 'due' })).toEqual(['Propane']);
    expect(names({ filter: 'reorder' })).toEqual(['Propane']);
    expect(names({ search: 'amerigas' })).toEqual(['Propane']);
    expect(names({ search: 'TIE' })).toEqual(['Hair ties']);
  });
});
