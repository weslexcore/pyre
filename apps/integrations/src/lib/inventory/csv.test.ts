import { describe, expect, it } from 'vitest';
import { ledgerToCsv } from './csv';
import type { InventoryMovementRow } from './types';

const row = (over: Partial<InventoryMovementRow>): InventoryMovementRow => ({
  id: 'm1',
  item_id: 'i1',
  area_id: 'a1',
  movement_type: 'use',
  quantity: -2,
  unit_cost_cents: 250,
  reason: null,
  note: null,
  transfer_group: null,
  count_line_id: null,
  recorded_by: 'sam@pyre.test',
  occurred_at: '2026-10-02T12:00:00.000Z',
  created_at: '2026-10-02T12:00:00.000Z',
  ...over,
});

const ctx = {
  itemNames: new Map([['i1', { name: 'Towels', unit: 'towel' }]]),
  areaNames: new Map([['a1', 'Back closet']]),
};

describe('ledgerToCsv', () => {
  it('writes names, labels, and the signed value', () => {
    const [header, line] = ledgerToCsv([row({})], ctx)
      .trim()
      .split('\r\n');
    expect(header.startsWith('Occurred at,Item,Unit,Area,Type')).toBe(true);
    expect(line).toBe(
      '2026-10-02T12:00:00.000Z,Towels,towel,Back closet,Used,-2,2.5,-5,,,sam@pyre.test'
    );
  });

  it('quotes commas and defuses formulas in staff-typed text', () => {
    const line = ledgerToCsv([row({ note: '=HYPERLINK("x")', reason: 'wet, torn' })], ctx)
      .trim()
      .split('\r\n')[1];
    expect(line).toContain('"wet, torn"');
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
