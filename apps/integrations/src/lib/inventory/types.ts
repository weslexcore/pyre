// Inventory: the row shape and the /api/admin/inventory response. Shared by
// the route and the /admin/inventory island (client-bundle-safe: no db/env
// imports). The schema lives in
// apps/supabase/migrations/20261026192124_inventory_simple_list.sql.

import type { PeopleNames } from '@/lib/sops/names';

export const INVENTORY_HREF = '/admin/inventory';
export const INVENTORY_API = '/api/admin/inventory';

/** The list filtered to what needs re-ordering — where low-stock alerts link. */
export const REORDER_HREF = `${INVENTORY_HREF}?filter=reorder`;

export interface InventoryRow {
  id: string;
  name: string;
  /** Free-text grouping ("Cleaning"); null = uncategorised. */
  category: string | null;
  /** Cost of one unit, in cents. */
  unit_cost_cents: number | null;
  vendor: string | null;
  /** A URL to order from, or written instructions. */
  how_to_order: string | null;
  /** Count at least every this many studio days (1 = daily); null = no schedule. */
  count_every_days: number | null;
  last_counted_at: string | null;
  /** Email of whoever last set the stock number. */
  last_counted_by: string | null;
  in_stock: number;
  /** Flag for re-order at or below this; null = never. */
  reorder_at: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** The fields inventory:manage edits (In stock: anyone); the route stamps the rest. */
export type InventoryFields = Pick<
  InventoryRow,
  | 'name'
  | 'category'
  | 'unit_cost_cents'
  | 'vendor'
  | 'how_to_order'
  | 'count_every_days'
  | 'in_stock'
  | 'reorder_at'
>;

export interface InventoryResponse {
  items: InventoryRow[];
  /** Names for the last_counted_by emails. */
  people: PeopleNames;
  /**
   * inventory:manage (or an admin holding the page): edit every column, add,
   * and delete. Without it the viewer counts — sets In stock — and reads.
   */
  canManage: boolean;
}
