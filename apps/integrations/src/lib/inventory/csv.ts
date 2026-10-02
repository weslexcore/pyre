// CSV serialization for the inventory ledger export. Kept out of the API
// route so the escaping rules are unit-testable; same cell rules as the water
// log export (quote what would break a row, defuse spreadsheet formulas).

import { type InventoryMovementRow, MOVEMENT_LABELS } from './types';

export interface LedgerCsvContext {
  itemNames: Map<string, { name: string; unit: string }>;
  areaNames: Map<string, string>;
}

function cell(value: string | number | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const HEADERS = [
  'Occurred at',
  'Item',
  'Unit',
  'Area',
  'Type',
  'Quantity',
  'Unit cost ($)',
  'Value ($)',
  'Reason',
  'Note',
  'Recorded by',
];

/** Header row plus one line per movement, in the order given. */
export function ledgerToCsv(rows: readonly InventoryMovementRow[], ctx: LedgerCsvContext): string {
  const lines = [HEADERS.map(cell).join(',')];
  for (const row of rows) {
    const item = ctx.itemNames.get(row.item_id);
    const quantity = Number(row.quantity);
    // Plain numbers (dollars), so a spreadsheet can sum the column.
    const unitCost = row.unit_cost_cents == null ? null : row.unit_cost_cents / 100;
    const value =
      row.unit_cost_cents == null ? null : Math.round(quantity * row.unit_cost_cents) / 100;
    lines.push(
      [
        row.occurred_at,
        item?.name ?? row.item_id,
        item?.unit ?? '',
        ctx.areaNames.get(row.area_id) ?? row.area_id,
        MOVEMENT_LABELS[row.movement_type],
        quantity,
        unitCost,
        value,
        row.reason,
        row.note,
        row.recorded_by,
      ]
        .map(cell)
        .join(',')
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
