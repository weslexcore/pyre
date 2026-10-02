// Shape-checking for inventory setup writes (areas and items). Pure and
// client-bundle-safe: the setup forms cap their inputs at the same limits the
// server rejects at, which mirror the table's check constraints.
//
// Each normalizer turns a request body into the table's columns. With
// `partial`, only the fields present in the body are returned (a PATCH);
// without it, required fields must be there (a POST). Identity columns
// (created_by) are set by the route from the session and never read here.

import { MAX_QUANTITY } from './rules';

export const FIELD_LIMITS = {
  areaName: 80,
  areaDescription: 500,
  itemName: 120,
  category: 60,
  unit: 30,
  lotLabel: 30,
  vendor: 120,
  vendorUrl: 500,
  notes: 2000,
} as const;

export type Normalized<T> = { ok: true; value: T } | { ok: false; error: string };

type Columns = Record<string, string | number | boolean | null>;

const has = (body: Record<string, unknown>, key: string) => key in body;

/** Trimmed text or null; `undefined` for a non-string so callers can 400. */
function text(value: unknown, limit: number): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > limit) return undefined;
  return trimmed || null;
}

/** A non-negative number (or null to clear it); `undefined` when invalid. */
function amount(value: unknown, { allowNull = true, positive = false } = {}) {
  if (value == null || value === '') return allowNull ? null : undefined;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_QUANTITY) return undefined;
  if (positive && n === 0) return undefined;
  return Math.round(n * 100) / 100;
}

function integer(value: unknown, min: number, max: number): number | null | undefined {
  if (value == null || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) return undefined;
  return n;
}

/** Dollars from a form ("12.50") to whole cents, or null to clear. */
export function dollarsToCents(value: unknown): number | null | undefined {
  if (value == null || value === '') return null;
  const n = typeof value === 'string' ? Number(value.replace(/^\$/, '')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1_000_000) return undefined;
  return Math.round(n * 100);
}

export function normalizeArea(
  body: Record<string, unknown>,
  { partial = false } = {}
): Normalized<Columns> {
  const out: Columns = {};

  if (!partial || has(body, 'name')) {
    const name = text(body.name, FIELD_LIMITS.areaName);
    if (!name) return { ok: false, error: `name is required (max ${FIELD_LIMITS.areaName} chars)` };
    out.name = name;
  }
  if (has(body, 'description')) {
    const description = text(body.description, FIELD_LIMITS.areaDescription);
    if (description === undefined) return { ok: false, error: 'description is too long' };
    out.description = description;
  }
  if (has(body, 'sortOrder')) {
    const sortOrder = integer(body.sortOrder, -10_000, 10_000);
    if (sortOrder === undefined || sortOrder === null) {
      return { ok: false, error: 'sortOrder must be a whole number' };
    }
    out.sort_order = sortOrder;
  }
  if (has(body, 'countEveryDays')) {
    const days = integer(body.countEveryDays, 1, 365);
    if (days === undefined) return { ok: false, error: 'countEveryDays must be 1–365 or empty' };
    out.count_every_days = days;
  }
  if (has(body, 'active')) {
    if (typeof body.active !== 'boolean') return { ok: false, error: 'active must be true/false' };
    out.active = body.active;
  }
  return { ok: true, value: out };
}

export function normalizeItem(
  body: Record<string, unknown>,
  { partial = false } = {}
): Normalized<Columns> {
  const out: Columns = {};

  if (!partial || has(body, 'name')) {
    const name = text(body.name, FIELD_LIMITS.itemName);
    if (!name) return { ok: false, error: `name is required (max ${FIELD_LIMITS.itemName} chars)` };
    out.name = name;
  }
  if (!partial || has(body, 'unit')) {
    const unit = text(body.unit ?? 'each', FIELD_LIMITS.unit);
    if (!unit) return { ok: false, error: `unit is required (max ${FIELD_LIMITS.unit} chars)` };
    out.unit = unit;
  }

  const texts: Array<[string, string, number]> = [
    ['category', 'category', FIELD_LIMITS.category],
    ['lotLabel', 'lot_label', FIELD_LIMITS.lotLabel],
    ['vendor', 'vendor', FIELD_LIMITS.vendor],
    ['vendorUrl', 'vendor_url', FIELD_LIMITS.vendorUrl],
    ['notes', 'notes', FIELD_LIMITS.notes],
  ];
  for (const [key, column, limit] of texts) {
    if (!has(body, key)) continue;
    const value = text(body[key], limit);
    if (value === undefined)
      return { ok: false, error: `${key} must be text (max ${limit} chars)` };
    out[column] = value;
  }
  if (typeof out.vendor_url === 'string' && !/^https?:\/\//i.test(out.vendor_url)) {
    return { ok: false, error: 'vendorUrl must start with http:// or https://' };
  }

  if (!partial || has(body, 'lotSize')) {
    const lotSize = amount(body.lotSize ?? 1, { allowNull: false, positive: true });
    if (lotSize == null) return { ok: false, error: 'lotSize must be a number above 0' };
    out.lot_size = lotSize;
  }
  for (const [key, column] of [
    ['reorderLevel', 'reorder_level'],
    ['reorderTarget', 'reorder_target'],
  ] as const) {
    if (!has(body, key)) continue;
    const value = amount(body[key]);
    if (value === undefined) return { ok: false, error: `${key} must be a number ≥ 0 or empty` };
    out[column] = value;
  }
  if (
    typeof out.reorder_level === 'number' &&
    typeof out.reorder_target === 'number' &&
    out.reorder_target < out.reorder_level
  ) {
    return { ok: false, error: 'The fill-to level must be at least the re-order level' };
  }
  if (has(body, 'unitCost')) {
    const cents = dollarsToCents(body.unitCost);
    if (cents === undefined) return { ok: false, error: 'unitCost must be a dollar amount' };
    out.unit_cost_cents = cents;
  }
  if (has(body, 'active')) {
    if (typeof body.active !== 'boolean') return { ok: false, error: 'active must be true/false' };
    out.active = body.active;
  }
  return { ok: true, value: out };
}
