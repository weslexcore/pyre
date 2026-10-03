// Inventory overview for /admin/inventory: every area, item, spot, and the
// products their variants belong to, and the cached on-hand per spot — the whole stock screen in one read. The catalogue
// is small (tens of items, a handful of areas), so the island groups and
// filters client-side rather than paging.
//
// Gated on the /admin/inventory page grant. Writes go through
// inventory-movements (anyone with the page) and inventory-areas / -items /
// -spots / -categories / -units / -products (admins only).

import type { APIRoute } from 'astro';
import { beginRead, dbError, json } from '@/lib/http/route';
import {
  INVENTORY_HREF,
  type InventoryAreaRow,
  type InventoryCategoryRow,
  type InventoryItemRow,
  type InventoryOverview,
  type InventoryProductRow,
  type InventorySpotRow,
  type InventoryStockRow,
  type InventoryUnitRow,
} from '@/lib/inventory/types';

export const GET: APIRoute = async ({ cookies }) => {
  const ready = await beginRead(cookies, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db } = ready;

  const [areas, categories, units, products, items, spots, stock] = await Promise.all([
    db.from('inventory_areas').select('*').order('sort_order').order('name'),
    db.from('inventory_categories').select('*').order('sort_order').order('name'),
    db.from('inventory_units').select('*').order('sort_order').order('name'),
    db.from('inventory_products').select('*').order('name'),
    db.from('inventory_items').select('*').order('name'),
    db.from('inventory_item_spots').select('*'),
    db.from('inventory_stock').select('*'),
  ]);
  for (const result of [areas, categories, units, products, items, spots, stock]) {
    if (result.error) return dbError(result.error);
  }

  const body: InventoryOverview = {
    areas: (areas.data ?? []) as InventoryAreaRow[],
    categories: (categories.data ?? []) as InventoryCategoryRow[],
    units: (units.data ?? []) as InventoryUnitRow[],
    products: (products.data ?? []) as InventoryProductRow[],
    items: ((items.data ?? []) as InventoryItemRow[]).map(numericItem),
    spots: ((spots.data ?? []) as InventorySpotRow[]).map((s) => ({
      ...s,
      par_level: s.par_level == null ? null : Number(s.par_level),
    })),
    stock: ((stock.data ?? []) as InventoryStockRow[]).map((s) => ({
      ...s,
      quantity: Number(s.quantity),
    })),
    isAdmin: gate.access.isAdmin,
  };
  return json(body);
};

// PostgREST returns `numeric` columns as strings when they don't fit a JS
// number exactly; normalise so the island can do arithmetic.
function numericItem(item: InventoryItemRow): InventoryItemRow {
  return {
    ...item,
    lot_size: Number(item.lot_size),
    reorder_level: item.reorder_level == null ? null : Number(item.reorder_level),
    reorder_target: item.reorder_target == null ? null : Number(item.reorder_target),
  };
}
