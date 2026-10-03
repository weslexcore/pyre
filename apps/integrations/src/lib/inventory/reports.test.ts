import { describe, expect, it } from 'vitest';
import { stockSeries, summarize } from './reports';
import { crossedReorderLevel } from './rules';
import type { MovementType } from './types';

const mv = (
  item_id: string,
  area_id: string,
  movement_type: MovementType,
  quantity: number,
  unit_cost_cents: number | null = 100
) => ({
  item_id,
  area_id,
  movement_type,
  quantity,
  unit_cost_cents,
});

const lookups = {
  items: new Map([
    ['towels', { name: 'Towels', unit: 'towel', category_id: 'linens' }],
    ['spray', { name: 'Spray', unit: 'bottle', category_id: null }],
  ]),
  categories: new Map([['linens', 'Linens']]),
  areas: new Map([
    ['closet', 'Closet'],
    ['desk', 'Desk'],
  ]),
};

const movements = [
  mv('towels', 'closet', 'receive', 24, 250),
  mv('towels', 'closet', 'use', -6, 250),
  mv('towels', 'closet', 'count_adjust', -2, 250),
  mv('towels', 'closet', 'transfer', -4, 250),
  mv('towels', 'desk', 'transfer', 4, 250),
  mv('spray', 'closet', 'waste', -1, 1500),
  mv('spray', 'desk', 'count_adjust', 1, 1500),
  mv('spray', 'desk', 'correction', -3, 1500),
  mv('spray', 'desk', 'initial', 5, null),
];

describe('summarize', () => {
  it('buckets usage, waste, shortfall, found and receipts per item, biggest loss first', () => {
    const { rows, totals } = summarize(movements, 'item', lookups);
    expect(rows.map((r) => r.label)).toEqual(['Spray', 'Towels']);
    expect(rows[1]).toMatchObject({
      itemId: 'towels',
      unit: 'towel',
      used: 6,
      usedCents: 1500,
      short: 2,
      shortCents: 500,
      received: 24,
      receivedCents: 6000,
      wasted: 0,
    });
    expect(rows[0]).toMatchObject({ wasted: 1, wastedCents: 1500, found: 1, foundCents: 1500 });
    expect(totals).toMatchObject({ used: 6, wasted: 1, short: 2, found: 1, received: 24 });
  });

  it('ignores moves, corrections and opening balances', () => {
    const { totals } = summarize(
      [
        mv('towels', 'closet', 'transfer', -4),
        mv('towels', 'closet', 'correction', -9),
        mv('towels', 'closet', 'initial', 9),
      ],
      'item',
      lookups
    );
    expect(totals.used + totals.wasted + totals.short + totals.found + totals.received).toBe(0);
  });

  it('groups by category and by area', () => {
    expect(
      summarize(movements, 'category', lookups)
        .rows.map((r) => r.label)
        .sort()
    ).toEqual(['Linens', 'No category']);
    const byArea = summarize(movements, 'area', lookups).rows;
    expect(byArea.find((r) => r.label === 'Closet')).toMatchObject({
      used: 6,
      wasted: 1,
      short: 2,
    });
  });
});

describe('stockSeries', () => {
  it('runs the total forward from a starting level, skipping moves between spots', () => {
    const points = stockSeries(
      [
        { occurred_at: '2026-10-02T10:00:00Z', movement_type: 'use', quantity: -2 },
        { occurred_at: '2026-10-01T10:00:00Z', movement_type: 'receive', quantity: 12 },
        { occurred_at: '2026-10-03T10:00:00Z', movement_type: 'transfer', quantity: -4 },
        { occurred_at: '2026-10-03T10:00:00Z', movement_type: 'transfer', quantity: 4 },
        { occurred_at: '2026-10-04T10:00:00Z', movement_type: 'count_adjust', quantity: -1 },
      ],
      5
    );
    expect(points.map((p) => [p.type, p.qty])).toEqual([
      ['receive', 17],
      ['use', 15],
      ['count_adjust', 14],
    ]);
  });
});

describe('crossedReorderLevel', () => {
  it('alerts only on the move from above the level to at or below it', () => {
    const item = { reorder_level: 10 };
    expect(crossedReorderLevel(item, 12, 10)).toBe(true);
    expect(crossedReorderLevel(item, 11, 4)).toBe(true);
    expect(crossedReorderLevel(item, 10, 8)).toBe(false); // already low
    expect(crossedReorderLevel(item, 12, 11)).toBe(false);
    expect(crossedReorderLevel(item, 8, 14)).toBe(false); // restocked
    expect(crossedReorderLevel({ reorder_level: null }, 5, 0)).toBe(false);
  });
});
