// The inventory's pure rules: quantities, lots, low stock, and the stock
// screen's grouping. Unit-tested, and shared by the routes and the islands
// (client-bundle-safe).

import type {
  InventoryAreaRow,
  InventoryCategoryRow,
  InventoryItemRow,
  InventoryProductRow,
  InventorySpotRow,
  InventoryStockRow,
  MovementType,
} from './types';

/** Biggest single movement the app accepts — a sanity bound, not a policy. */
export const MAX_QUANTITY = 100_000;

/**
 * A positive quantity from a request or a form field: finite, above zero, at
 * most two decimals (half a jug of chlorine is real; 0.333 towels is not).
 * Returns null for anything else.
 */
export function parseQuantity(raw: unknown): number | null {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0 || value > MAX_QUANTITY) return null;
  if (Math.round(value * 100) !== value * 100) return null;
  return value;
}

/**
 * A signed correction amount: like parseQuantity but either sign, never
 * zero.
 */
export function parseSignedQuantity(raw: unknown): number | null {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || value === 0) return null;
  const magnitude = parseQuantity(Math.abs(value));
  return magnitude === null ? null : Math.sign(value) * magnitude;
}

/**
 * The ledger quantity for a staff-entered amount: usage and waste take stock
 * out, receiving and opening balances put it in. Transfers and corrections
 * carry their own sign and never go through here.
 */
export function signedQuantity(type: 'use' | 'waste' | 'receive' | 'initial', amount: number) {
  return type === 'use' || type === 'waste' ? -amount : amount;
}

/** Units in `lots` whole lots of an item ("2 cases" of 12 = 24). */
export function lotsToUnits(lots: number, lotSize: number): number {
  return Math.round(lots * lotSize * 100) / 100;
}

/** '12', '2.5' — no trailing zeros, at most two decimals. */
export function formatQuantity(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * A unit's two spellings. An item row fits as-is ({ unit, unit_plural }); so
 * does any view that carries an item's unit and plural.
 */
export interface UnitNames {
  unit: string;
  unit_plural?: string | null;
}

/**
 * A first guess at a plural, for suggesting one when a unit is added (the
 * admin can correct it) and for any unit that arrives without its plural.
 * Mirrors the guess 20261003162143_inventory_units.sql made for existing
 * units: a word already ending in a single "s" is left alone, as it was
 * usually typed as a plural.
 */
export function suggestPlural(word: string): string {
  const w = word.trim();
  if (!w) return w;
  if (/^(each|dozen)$/i.test(w)) return w;
  if (/(ss|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/s$/i.test(w)) return w;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

/** 'box' for 1, 'boxes' otherwise — the unit's own plural when known. */
export function pluralUnit(n: number, unit: string | UnitNames): string {
  const names = typeof unit === 'string' ? { unit } : unit;
  if (Math.abs(n) === 1) return names.unit;
  return names.unit_plural?.trim() || suggestPlural(names.unit);
}

/** '24 towels' / '1 box'. */
export function formatUnits(n: number, unit: string | UnitNames): string {
  return `${formatQuantity(n)} ${pluralUnit(n, unit)}`;
}

/** What an item is bought by, as a unit: its lot unit, or plain "lot". */
export function lotUnit(item: Pick<InventoryItemRow, 'lot_label' | 'lot_label_plural'>): UnitNames {
  return item.lot_label?.trim()
    ? { unit: item.lot_label.trim(), unit_plural: item.lot_label_plural }
    : { unit: 'lot', unit_plural: 'lots' };
}

/** 'case of 12', or '' when an item is bought one at a time. */
export function lotDescription(item: Pick<InventoryItemRow, 'lot_size' | 'lot_label'>): string {
  if (item.lot_size === 1 && !item.lot_label) return '';
  return `${item.lot_label?.trim() || 'lot'} of ${formatQuantity(item.lot_size)}`;
}

/** '$12.50' / '-$5.00' from cents, or '' when there is no cost. */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '';
  return `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Total on hand per item across every spot. */
export function totalsByItem(stock: readonly InventoryStockRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of stock) {
    totals.set(row.item_id, (totals.get(row.item_id) ?? 0) + Number(row.quantity));
  }
  return totals;
}

/** At or below its re-order level. Items with no level are never low. */
export function isLowStock(item: Pick<InventoryItemRow, 'reorder_level'>, total: number): boolean {
  return item.reorder_level != null && total <= Number(item.reorder_level);
}

/**
 * Whole lots to order to get back to the fill-to level (or the re-order
 * level when no target is set). A low item always suggests at least one lot;
 * null when the item has no re-order settings.
 */
export function suggestedLots(
  item: Pick<InventoryItemRow, 'reorder_level' | 'reorder_target' | 'lot_size'>,
  total: number
): number | null {
  const target = item.reorder_target ?? item.reorder_level;
  if (target == null) return null;
  const need = Number(target) - total;
  const lots = need > 0 ? Math.ceil(need / Number(item.lot_size)) : 0;
  return isLowStock(item, total) ? Math.max(lots, 1) : lots;
}

/**
 * Whether a change just took an item to its re-order level: above it before,
 * at or below it after. Only that moment alerts — an item already low stays
 * quiet while it is used further, rather than alerting on every use.
 */
export function crossedReorderLevel(
  item: Pick<InventoryItemRow, 'reorder_level'>,
  before: number,
  after: number
): boolean {
  if (item.reorder_level == null) return false;
  const level = Number(item.reorder_level);
  return before > level && after <= level;
}

/** Usage vs loss for reports: which bucket a ledger row's quantity lands in. */
export function movementBucket(
  type: MovementType,
  quantity: number
): 'usage' | 'explained_loss' | 'unexplained_loss' | 'found' | 'inflow' | 'neutral' {
  switch (type) {
    case 'use':
      return 'usage';
    case 'waste':
      return 'explained_loss';
    case 'count_adjust':
      return quantity < 0 ? 'unexplained_loss' : 'found';
    case 'receive':
      return 'inflow';
    default:
      return 'neutral';
  }
}

export interface StockLine {
  item: InventoryItemRow;
  spot: InventorySpotRow;
  quantity: number;
  /** The item's total across every spot, for the low-stock badge. */
  total: number;
  low: boolean;
}

export interface StockArea {
  area: InventoryAreaRow;
  lines: StockLine[];
}

const byOrderThenName = <T extends { sort_order: number }>(
  a: T,
  b: T,
  nameA: string,
  nameB: string
) => a.sort_order - b.sort_order || nameA.localeCompare(nameB);

/**
 * Items by name, except that variants of one product keep their set order
 * (S, M, L, XL — not alphabetical). Their names share the product prefix, so
 * a product's variants still sit together among other items.
 */
export function compareItems(
  a: Pick<InventoryItemRow, 'name' | 'product_id' | 'variant_order'>,
  b: Pick<InventoryItemRow, 'name' | 'product_id' | 'variant_order'>
): number {
  if (a.product_id && a.product_id === b.product_id) {
    return a.variant_order - b.variant_order || a.name.localeCompare(b.name);
  }
  return a.name.localeCompare(b.name);
}

/**
 * The stock screen: active areas in walk order, each with its active items
 * in shelf order. An area with no items still appears, so it can be found
 * and stocked.
 */
export function groupStockByArea(data: {
  areas: readonly InventoryAreaRow[];
  items: readonly InventoryItemRow[];
  spots: readonly InventorySpotRow[];
  stock: readonly InventoryStockRow[];
}): StockArea[] {
  const items = new Map(data.items.filter((i) => i.active).map((i) => [i.id, i]));
  const totals = totalsByItem(data.stock);
  const onHand = new Map(data.stock.map((s) => [`${s.item_id}:${s.area_id}`, Number(s.quantity)]));

  return data.areas
    .filter((a) => a.active)
    .sort((a, b) => byOrderThenName(a, b, a.name, b.name))
    .map((area) => {
      const lines: StockLine[] = [];
      for (const spot of data.spots) {
        const item = items.get(spot.item_id);
        if (spot.area_id !== area.id || !item) continue;
        const total = totals.get(item.id) ?? 0;
        lines.push({
          item,
          spot,
          quantity: onHand.get(`${item.id}:${area.id}`) ?? 0,
          total,
          low: isLowStock(item, total),
        });
      }
      lines.sort((a, b) => a.spot.sort_order - b.spot.sort_order || compareItems(a.item, b.item));
      return { area, lines };
    });
}

export interface StockItem {
  item: InventoryItemRow;
  /** Across every spot. */
  total: number;
  low: boolean;
  /** One per spot the item lives in, in walk order. */
  lines: StockLine[];
}

/** A product's variants, together, in the by-category view. */
export interface StockProduct {
  product: InventoryProductRow;
  /** Active variants in their set order. */
  variants: StockItem[];
  /** Across every variant and spot. */
  total: number;
  /** Whether any variant is low. */
  low: boolean;
}

export type StockEntry = ({ kind: 'item' } & StockItem) | ({ kind: 'product' } & StockProduct);

export interface StockCategory {
  /** null = items with no category. */
  category: InventoryCategoryRow | null;
  /** Standalone items and products, by name. */
  entries: StockEntry[];
}

/**
 * The stock screen by category: categories in display order (a retired one
 * still shows while items carry it), each with its active items by name and
 * where each one is stored. A product's variants are gathered under it, in
 * their set order. Uncategorised items come last. Categories with no active
 * items are left out — unlike an empty area, there's nothing to do with one
 * here.
 */
export function groupStockByCategory(data: {
  areas: readonly InventoryAreaRow[];
  categories: readonly InventoryCategoryRow[];
  products: readonly InventoryProductRow[];
  items: readonly InventoryItemRow[];
  spots: readonly InventorySpotRow[];
  stock: readonly InventoryStockRow[];
}): StockCategory[] {
  const totals = totalsByItem(data.stock);
  const linesByItem = new Map<string, StockLine[]>();
  for (const { lines } of groupStockByArea(data)) {
    for (const line of lines) {
      const list = linesByItem.get(line.item.id) ?? [];
      list.push(line);
      linesByItem.set(line.item.id, list);
    }
  }
  const products = new Map(data.products.map((p) => [p.id, p]));

  const byCategory = new Map<string | null, StockEntry[]>();
  const productEntries = new Map<string, { kind: 'product' } & StockProduct>();
  const add = (categoryId: string | null, entry: StockEntry) => {
    const known = categoryId && data.categories.some((c) => c.id === categoryId);
    const key = known ? categoryId : null;
    const list = byCategory.get(key) ?? [];
    list.push(entry);
    byCategory.set(key, list);
  };

  for (const item of data.items) {
    if (!item.active) continue;
    const total = totals.get(item.id) ?? 0;
    const stockItem: StockItem = {
      item,
      total,
      low: isLowStock(item, total),
      lines: linesByItem.get(item.id) ?? [],
    };
    const product = item.product_id ? products.get(item.product_id) : undefined;
    if (!product) {
      add(item.category_id, { kind: 'item', ...stockItem });
      continue;
    }
    let entry = productEntries.get(product.id);
    if (!entry) {
      entry = { kind: 'product', product, variants: [], total: 0, low: false };
      productEntries.set(product.id, entry);
      add(product.category_id, entry);
    }
    entry.variants.push(stockItem);
    entry.total = Math.round((entry.total + total) * 100) / 100;
    entry.low ||= stockItem.low;
  }
  for (const entry of productEntries.values()) {
    entry.variants.sort((a, b) => compareItems(a.item, b.item));
  }
  const entryName = (e: StockEntry) => (e.kind === 'item' ? e.item.name : e.product.name);
  for (const list of byCategory.values()) {
    list.sort((a, b) => entryName(a).localeCompare(entryName(b)));
  }

  const grouped: StockCategory[] = [...data.categories]
    .sort((a, b) => byOrderThenName(a, b, a.name, b.name))
    .filter((c) => byCategory.has(c.id))
    .map((category) => ({ category, entries: byCategory.get(category.id) ?? [] }));
  const uncategorised = byCategory.get(null);
  if (uncategorised) grouped.push({ category: null, entries: uncategorised });
  return grouped;
}
