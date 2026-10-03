// Reports over the inventory ledger: usage vs loss per item, category, or
// area for a period, and an item's stock level over time. Pure and
// unit-tested; the /api/admin/inventory-reports route supplies the rows.
//
// The buckets are the ledger's movement types (see movementBucket):
//   used      — `use`: consumed in operations
//   wasted    — `waste`: known loss (broken, expired)
//   short     — negative `count_adjust`: unexplained loss found by a count
//   found     — positive `count_adjust`: stock a count found
//   received  — `receive`: deliveries
// Moves between spots, opening balances and admin corrections are neutral.

import { movementBucket } from './rules';
import type { InventoryMovementRow, ReportGroup, ReportRow, StockPoint } from './types';

export type ReportFigures = Omit<ReportRow, 'key' | 'label' | 'unit' | 'itemId'>;

export const emptyFigures = (): ReportFigures => ({
  used: 0,
  usedCents: 0,
  wasted: 0,
  wastedCents: 0,
  short: 0,
  shortCents: 0,
  found: 0,
  foundCents: 0,
  received: 0,
  receivedCents: 0,
});

type Movement = Pick<
  InventoryMovementRow,
  'item_id' | 'area_id' | 'movement_type' | 'quantity' | 'unit_cost_cents'
>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Adds one movement into a set of figures (units always positive). */
export function addMovement(figures: ReportFigures, m: Movement): void {
  const qty = Math.abs(Number(m.quantity));
  const cents = m.unit_cost_cents == null ? 0 : Math.round(qty * m.unit_cost_cents);
  switch (movementBucket(m.movement_type, Number(m.quantity))) {
    case 'usage':
      figures.used = round2(figures.used + qty);
      figures.usedCents += cents;
      break;
    case 'explained_loss':
      figures.wasted = round2(figures.wasted + qty);
      figures.wastedCents += cents;
      break;
    case 'unexplained_loss':
      figures.short = round2(figures.short + qty);
      figures.shortCents += cents;
      break;
    case 'found':
      figures.found = round2(figures.found + qty);
      figures.foundCents += cents;
      break;
    case 'inflow':
      figures.received = round2(figures.received + qty);
      figures.receivedCents += cents;
      break;
    default:
      break;
  }
}

export interface ReportLookups {
  items: Map<string, { name: string; unit: string; category_id: string | null }>;
  categories: Map<string, string>;
  areas: Map<string, string>;
}

/**
 * Figures per group for the movements given (already limited to the
 * period), plus overall totals. Groups with no usage, loss, or inflow are
 * left out; rows are ordered by total loss in dollars, then usage, so the
 * biggest problems lead.
 */
export function summarize(
  movements: readonly Movement[],
  groupBy: ReportGroup,
  lookups: ReportLookups
): { rows: ReportRow[]; totals: ReportFigures } {
  const rows = new Map<string, ReportRow>();
  const totals = emptyFigures();

  for (const m of movements) {
    const item = lookups.items.get(m.item_id);
    let key: string;
    let label: string;
    if (groupBy === 'item') {
      key = m.item_id;
      label = item?.name ?? 'Unknown item';
    } else if (groupBy === 'category') {
      key = item?.category_id ?? 'none';
      label = item?.category_id
        ? (lookups.categories.get(item.category_id) ?? 'Unknown category')
        : 'No category';
    } else {
      key = m.area_id;
      label = lookups.areas.get(m.area_id) ?? 'Unknown area';
    }
    let row = rows.get(key);
    if (!row) {
      row = { key, label, ...emptyFigures() };
      if (groupBy === 'item') {
        row.unit = item?.unit ?? '';
        row.itemId = m.item_id;
      }
      rows.set(key, row);
    }
    addMovement(row, m);
    addMovement(totals, m);
  }

  const loss = (r: ReportFigures) => r.wastedCents + r.shortCents;
  const sorted = [...rows.values()]
    .filter((r) => r.used || r.wasted || r.short || r.found || r.received)
    .sort(
      (a, b) =>
        loss(b) - loss(a) ||
        b.wasted + b.short - (a.wasted + a.short) ||
        b.usedCents - a.usedCents ||
        b.used - a.used ||
        a.label.localeCompare(b.label)
    );
  return { rows: sorted, totals };
}

/**
 * An item's total on hand after each movement, oldest first, starting from
 * `startQty` (the level before the first movement given). Moves between
 * spots don't change the total, so they are folded out: only changes to how
 * much the place holds make a point.
 */
export function stockSeries(
  movements: readonly Pick<InventoryMovementRow, 'occurred_at' | 'movement_type' | 'quantity'>[],
  startQty = 0
): StockPoint[] {
  const sorted = [...movements].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const points: StockPoint[] = [];
  let qty = startQty;
  for (const m of sorted) {
    if (m.movement_type === 'transfer') continue;
    const change = Number(m.quantity);
    qty = round2(qty + change);
    points.push({ t: m.occurred_at, qty, type: m.movement_type, change });
  }
  return points;
}
