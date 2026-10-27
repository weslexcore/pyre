// Inventory's pure rules: validating a row, when an item is due for a count
// or needs re-ordering, and the list's filter and sort. Unit-tested; shared
// by /api/admin/inventory and the /admin/inventory island
// (client-bundle-safe).

import { easternDate } from '@pyre/schedule-core';
import type { InventoryFields, InventoryRow } from './types';

export const MAX_QUANTITY = 100_000;
const MAX_NAME = 120;
const MAX_VENDOR = 120;
const MAX_CATEGORY = 60;
const MAX_LOCATION = 120;
const MAX_HOW_TO_ORDER = 2000;
const MAX_INSTRUCTIONS = 2000;
const MAX_COST_CENTS = 10_000_000;
const DAY_MS = 86_400_000;

/** The count schedules the list offers, in studio days. */
export const COUNT_SCHEDULES = [1, 7, 14, 30, 90] as const;

/** 'Daily', 'Weekly', 'Every 2 weeks', 'Monthly', 'Quarterly', or 'Every 3 days'. */
export function countEveryLabel(days: number): string {
  if (days === 1) return 'Daily';
  if (days === 7) return 'Weekly';
  if (days === 14) return 'Every 2 weeks';
  if (days === 30) return 'Monthly';
  if (days === 90) return 'Quarterly';
  return `Every ${days} days`;
}

/** '12', '2.5' — no trailing zeros. */
export function formatQuantity(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** '$4.50', or '' for no cost. */
export function formatCents(cents: number | null): string {
  return cents == null ? '' : `$${(cents / 100).toFixed(2)}`;
}

/** A quantity a person typed: a number from 0 to MAX_QUANTITY, else null. */
export function parseQuantity(raw: unknown): number | null {
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_QUANTITY) return null;
  return Math.round(n * 100) / 100;
}

/** '$4.50' / '4.5' / '4' → cents; null when it isn't a price. */
export function parseDollars(raw: string): number | null {
  const s = raw.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents <= MAX_COST_CENTS ? cents : null;
}

/** The URL to link when how_to_order is (or starts with) one. */
export function orderLink(howToOrder: string | null): string | null {
  const first = howToOrder?.trim().split(/\s+/)[0] ?? '';
  return /^https?:\/\/\S+$/i.test(first) ? first : null;
}

/** Whole studio days from one YYYY-MM-DD to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
}

/**
 * Whether an item is due for a count: it has a schedule and has never been
 * counted, or that many studio calendar days have turned over since it was
 * — so "daily" is due again each new day however late yesterday's count.
 */
export function isDue(
  item: Pick<InventoryRow, 'count_every_days' | 'last_counted_at'>,
  now: Date
): boolean {
  if (!item.count_every_days) return false;
  if (!item.last_counted_at) return true;
  const days = daysBetween(easternDate(new Date(item.last_counted_at)), easternDate(now));
  return days >= item.count_every_days;
}

/** At or below its re-order level. */
export function isLow(item: Pick<InventoryRow, 'reorder_at' | 'in_stock'>): boolean {
  return item.reorder_at != null && item.in_stock <= item.reorder_at;
}

/** A stock change that takes an item from above its re-order level to at or below it. */
export function crossedReorderLevel(reorderAt: number | null, before: number, after: number) {
  return reorderAt != null && before > reorderAt && after <= reorderAt;
}

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

function optionalText(raw: unknown, max: number, label: string): string | null | Error {
  if (raw == null) return null;
  if (typeof raw !== 'string') return new Error(`${label} must be text`);
  const s = raw.trim();
  if (s.length > max) return new Error(`${label} must be at most ${max} characters`);
  return s || null;
}

/**
 * Checks the editable fields of a row from a request body. With `partial`,
 * only the keys present are checked and returned (a PATCH); otherwise a name
 * is required and absent fields default to empty (a POST).
 */
export function normalizeFields(
  body: Record<string, unknown>,
  { partial = false }: { partial?: boolean } = {}
): Validated<Partial<InventoryFields>> {
  const out: Partial<InventoryFields> = {};
  const has = (key: keyof InventoryFields) => !partial || key in body;

  if (has('name')) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { ok: false, error: 'Give the item a name' };
    if (name.length > MAX_NAME) {
      return { ok: false, error: `Names are at most ${MAX_NAME} characters` };
    }
    out.name = name;
  }
  if (has('category')) {
    const category = optionalText(body.category, MAX_CATEGORY, 'Category');
    if (category instanceof Error) return { ok: false, error: category.message };
    out.category = category;
  }
  if (has('vendor')) {
    const vendor = optionalText(body.vendor, MAX_VENDOR, 'Vendor');
    if (vendor instanceof Error) return { ok: false, error: vendor.message };
    out.vendor = vendor;
  }
  if (has('how_to_order')) {
    const how = optionalText(body.how_to_order, MAX_HOW_TO_ORDER, 'How to order');
    if (how instanceof Error) return { ok: false, error: how.message };
    out.how_to_order = how;
  }
  if (has('location')) {
    const location = optionalText(body.location, MAX_LOCATION, 'Location');
    if (location instanceof Error) return { ok: false, error: location.message };
    out.location = location;
  }
  if (has('count_instructions')) {
    const how = optionalText(body.count_instructions, MAX_INSTRUCTIONS, 'Count instructions');
    if (how instanceof Error) return { ok: false, error: how.message };
    out.count_instructions = how;
  }
  if (has('unit_cost_cents')) {
    const cents = body.unit_cost_cents;
    if (cents == null) out.unit_cost_cents = null;
    else if (
      !Number.isInteger(cents) ||
      (cents as number) < 0 ||
      (cents as number) > MAX_COST_CENTS
    ) {
      return { ok: false, error: 'Cost must be a price' };
    } else out.unit_cost_cents = cents as number;
  }
  if (has('count_every_days')) {
    const days = body.count_every_days;
    if (days == null) out.count_every_days = null;
    else if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 365) {
      return { ok: false, error: 'Count schedule must be 1 to 365 days' };
    } else out.count_every_days = days as number;
  }
  if (has('in_stock')) {
    const n = body.in_stock == null && !partial ? 0 : parseQuantity(body.in_stock);
    if (n == null)
      return { ok: false, error: `In stock must be a number from 0 to ${MAX_QUANTITY}` };
    out.in_stock = n;
  }
  if (has('reorder_at')) {
    if (body.reorder_at == null || body.reorder_at === '') out.reorder_at = null;
    else {
      const n = parseQuantity(body.reorder_at);
      if (n == null) {
        return { ok: false, error: `Re-order at must be a number from 0 to ${MAX_QUANTITY}` };
      }
      out.reorder_at = n;
    }
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Usage: how fast an item goes, from its history
// ---------------------------------------------------------------------------

/** The stretch of history usage rates are worked out over. */
export const USAGE_WINDOW_DAYS = 90;

/** A look at the shelf: the stock on hand at a time. */
export interface StockPoint {
  in_stock: number;
  at: string;
}

export interface Usage {
  /** Units used: the drops between looks. */
  used: number;
  /** Days those drops were measured over (restock stretches left out). */
  days: number;
  perDay: number;
  /** Times the stock went up between looks. */
  restocks: number;
}

/**
 * How fast an item is used, from its stock over time. Between two looks a
 * drop is what was used; a rise means a delivery came in, and how much was
 * used around it is unknown, so that stretch is left out of both the units
 * and the days rather than guessed at. Only looks within `windowDays` of
 * `now` count. Null until there's at least a day of measured history.
 */
export function usageOf(
  points: readonly StockPoint[],
  now: Date,
  windowDays = USAGE_WINDOW_DAYS
): Usage | null {
  const since = now.getTime() - windowDays * DAY_MS;
  const series = points
    .map((p) => ({ n: p.in_stock, t: Date.parse(p.at) }))
    .filter((p) => p.t >= since && p.t <= now.getTime())
    .sort((a, b) => a.t - b.t);
  let used = 0;
  let ms = 0;
  let restocks = 0;
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const next = series[i];
    if (next.n > prev.n) restocks++;
    else {
      used += prev.n - next.n;
      ms += next.t - prev.t;
    }
  }
  const days = ms / DAY_MS;
  if (days < 1) return null;
  return { used, days, perDay: used / days, restocks };
}

/** Days until it runs out at its usage rate; null when the rate is unknown or nil. */
export function daysLeft(item: Pick<InventoryRow, 'in_stock' | 'usage_per_day'>): number | null {
  return item.usage_per_day ? item.in_stock / item.usage_per_day : null;
}

/** '3.5 / wk' for a rate per day. */
export function formatPerWeek(perDay: number): string {
  return `${formatQuantity(Math.round(perDay * 7 * 10) / 10)} / wk`;
}

/** 'Out', 'Under a day', '5 days', '3 weeks', '4 months'. */
export function formatDaysLeft(days: number): string {
  if (days <= 0) return 'Out';
  if (days < 1) return 'Under a day';
  if (days < 14) return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`;
  if (days < 70) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

// ---------------------------------------------------------------------------
// The list: filter and sort
// ---------------------------------------------------------------------------

export type InventoryFilter = 'all' | 'due' | 'reorder';

export type SortKey =
  | 'name'
  | 'category'
  | 'location'
  | 'in_stock'
  | 'usage'
  | 'days_left'
  | 'reorder_at'
  | 'due'
  | 'last_counted_at'
  | 'count_every_days'
  | 'unit_cost_cents'
  | 'vendor';

export interface ListQuery {
  search: string;
  filter: InventoryFilter;
  /** '' = every category; UNCATEGORISED = items without one. */
  category: string;
  sort: SortKey;
  desc: boolean;
}

/** The category filter's value for items with no category. */
export const UNCATEGORISED = '\u0000none';

/** Whether an item matches a search term (name, category, location, vendor, or how to order). */
export function matchesSearch(item: InventoryRow, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.category, item.location, item.vendor, item.how_to_order].some((s) =>
    s?.toLowerCase().includes(q)
  );
}

/** The distinct non-empty values of a field, sorted for a drop-down. */
export function distinctValues(
  items: readonly InventoryRow[],
  key: 'vendor' | 'category' | 'location'
): string[] {
  const values = new Set<string>();
  for (const item of items) if (item[key]) values.add(item[key] as string);
  return [...values].sort((a, b) => a.localeCompare(b));
}

function sortValue(item: InventoryRow, key: SortKey, now: Date): string | number | null {
  switch (key) {
    case 'name':
      return item.name.toLowerCase();
    case 'vendor':
      return item.vendor?.toLowerCase() ?? null;
    case 'category':
      return item.category?.toLowerCase() ?? null;
    case 'location':
      return item.location?.toLowerCase() ?? null;
    case 'usage':
      return item.usage_per_day ?? null;
    case 'days_left':
      return daysLeft(item);
    case 'due':
      // due first, then scheduled-and-fine, then unscheduled
      return isDue(item, now) ? 0 : item.count_every_days ? 1 : 2;
    case 'last_counted_at':
      return item.last_counted_at;
    default:
      return item[key];
  }
}

/**
 * The rows the list shows, in order. Empty values sort last either way, and
 * ties fall back to the name so the order never jumps between renders.
 */
export function listItems(
  items: readonly InventoryRow[],
  query: ListQuery,
  now: Date
): InventoryRow[] {
  const rows = items.filter(
    (item) =>
      matchesSearch(item, query.search) &&
      (!query.category ||
        (query.category === UNCATEGORISED ? !item.category : item.category === query.category)) &&
      (query.filter === 'all' ||
        (query.filter === 'due' && isDue(item, now)) ||
        (query.filter === 'reorder' && isLow(item)))
  );
  const dir = query.desc ? -1 : 1;
  return rows.sort((a, b) => {
    const av = sortValue(a, query.sort, now);
    const bv = sortValue(b, query.sort, now);
    if (av !== bv) {
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : 1) * dir;
    }
    return a.name.localeCompare(b.name);
  });
}
