// What changed on an inventory item, and how the History tab words it. Pure
// and client-bundle-safe: history.ts diffs and merges rows with it on the
// server, and InventoryHistory labels them in the dialog.

import { countEveryLabel, formatCents, formatQuantity } from './rules';
import type { FieldChange, InventoryFields, InventoryHistoryEntry } from './types';

/** The fields the history tracks, in the order the log lists them. */
export const TRACKED_FIELDS: (keyof InventoryFields)[] = [
  'active',
  'name',
  'category',
  'location',
  'in_stock',
  'reorder_at',
  'count_every_days',
  'count_instructions',
  'unit_cost_cents',
  'vendor',
  'how_to_order',
];

export const FIELD_LABELS: Record<keyof InventoryFields, string> = {
  active: 'Status',
  name: 'Name',
  category: 'Category',
  location: 'Location',
  in_stock: 'In stock',
  reorder_at: 'Re-order at',
  count_every_days: 'Count every',
  count_instructions: 'Count instructions',
  unit_cost_cents: 'Cost per unit',
  vendor: 'Vendor',
  how_to_order: 'How to order',
};

type Changes = InventoryHistoryEntry['changes'];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Each tracked field that differs between two versions of an item (`before` null = new). */
export function diffItems(
  before: Partial<InventoryFields> | null,
  after: Partial<InventoryFields>
): Changes {
  const out: Changes = {};
  for (const key of TRACKED_FIELDS) {
    if (!(key in after)) continue;
    const from = before ? (before[key] ?? null) : null;
    const to = after[key] ?? null;
    if (!same(from, to)) out[key] = { from, to };
  }
  return out;
}

/**
 * A newer change folded into an earlier one: each field keeps its first
 * "from" and takes the latest "to", and a field that ended where it started
 * drops out.
 */
export function mergeChanges(earlier: Changes, later: Changes): Changes {
  const out: Changes = { ...earlier };
  for (const [key, change] of Object.entries(later) as [keyof InventoryFields, FieldChange][]) {
    const first = out[key];
    const merged = { from: first ? first.from : change.from, to: change.to };
    if (same(merged.from, merged.to)) delete out[key];
    else out[key] = merged;
  }
  return out;
}

const MAX_SHOWN = 80;

/** One field's value as the log shows it; null for no value. */
export function formatFieldValue(key: keyof InventoryFields, value: unknown): string | null {
  if (value == null || value === '') return null;
  switch (key) {
    case 'active':
      return value ? 'Active' : 'Inactive';
    case 'in_stock':
    case 'reorder_at':
      return formatQuantity(Number(value));
    case 'unit_cost_cents':
      return formatCents(Number(value));
    case 'count_every_days':
      return countEveryLabel(Number(value));
    default: {
      const s = String(value).replace(/\s+/g, ' ').trim();
      return s.length > MAX_SHOWN ? `${s.slice(0, MAX_SHOWN - 1)}…` : s;
    }
  }
}

/** '+12' / '−3' for a stock change, or null when either side isn't a number. */
export function stockDelta(change: FieldChange | undefined): string | null {
  if (!change || change.from == null || change.to == null) return null;
  const d = Number(change.to) - Number(change.from);
  if (!Number.isFinite(d) || d === 0) return null;
  return d > 0 ? `+${formatQuantity(d)}` : `−${formatQuantity(-d)}`;
}

/** The changed fields of an entry, in TRACKED_FIELDS order. */
export function changedFields(entry: Pick<InventoryHistoryEntry, 'changes'>) {
  return TRACKED_FIELDS.filter((key) => entry.changes[key]).map((key) => ({
    key,
    label: FIELD_LABELS[key],
    change: entry.changes[key] as FieldChange,
  }));
}
