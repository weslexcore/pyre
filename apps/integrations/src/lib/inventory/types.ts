// Operational inventory: row shapes, the ledger's movement types, and their
// labels. Shared by the /api/admin/inventory* routes and the /admin/inventory
// islands (client-bundle-safe: no db/env imports). The schema lives in
// apps/supabase/migrations/*_inventory.sql.

export const INVENTORY_HREF = '/admin/inventory';

export interface InventoryAreaRow {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  count_every_days: number | null;
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** An admin-configured grouping offered in the item form's drop-down. */
export interface InventoryCategoryRow {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type InventoryItemKind = 'operational';

export interface InventoryItemRow {
  id: string;
  name: string;
  kind: InventoryItemKind;
  category_id: string | null;
  unit: string;
  lot_size: number;
  lot_label: string | null;
  reorder_level: number | null;
  reorder_target: number | null;
  unit_cost_cents: number | null;
  vendor: string | null;
  vendor_url: string | null;
  notes: string | null;
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface InventorySpotRow {
  id: string;
  item_id: string;
  area_id: string;
  sort_order: number;
  par_level: number | null;
  created_at: string;
}

export interface InventoryStockRow {
  item_id: string;
  area_id: string;
  quantity: number;
  updated_at: string;
}

/**
 * Why stock changed. The split that matters for loss tracking: `use` is
 * consumption, `waste` is known loss, and a negative `count_adjust` is
 * unexplained loss (a count found fewer than the ledger expected).
 */
export const MOVEMENT_TYPES = [
  'initial',
  'receive',
  'use',
  'waste',
  'count_adjust',
  'transfer',
  'correction',
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

export function isMovementType(value: unknown): value is MovementType {
  return typeof value === 'string' && (MOVEMENT_TYPES as readonly string[]).includes(value);
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  initial: 'Opening balance',
  receive: 'Received',
  use: 'Used',
  waste: 'Waste',
  count_adjust: 'Count adjustment',
  transfer: 'Moved',
  correction: 'Correction',
};

/** What each type means, for the info tips and the history legend. */
export const MOVEMENT_DESCRIPTIONS: Record<MovementType, string> = {
  initial: 'Starting quantity when an item is first set up in a spot.',
  receive: 'A delivery arrived or stock was restocked.',
  use: 'Taken out to be used in operations.',
  waste: 'Known loss — broken, expired, contaminated.',
  count_adjust: 'A count found more or fewer than expected. Fewer is unexplained loss.',
  transfer: 'Moved from one storage spot to another.',
  correction: 'An admin fixing a mis-entry. Not counted as usage or loss.',
};

/** Types any staff member may log from the stock screen. */
export const STAFF_MOVEMENT_TYPES = ['use', 'receive', 'waste', 'transfer'] as const;
export type StaffMovementType = (typeof STAFF_MOVEMENT_TYPES)[number];

/** Types only admins may log (setup and fixing mistakes). */
export const ADMIN_MOVEMENT_TYPES = ['initial', 'correction'] as const;
export type AdminMovementType = (typeof ADMIN_MOVEMENT_TYPES)[number];

/** Common waste reasons offered as one-tap chips (free text is also fine). */
export const WASTE_REASONS = ['Expired', 'Broken', 'Damaged', 'Contaminated', 'Spilled'] as const;

export interface InventoryMovementRow {
  id: string;
  item_id: string;
  area_id: string;
  movement_type: MovementType;
  quantity: number;
  unit_cost_cents: number | null;
  reason: string | null;
  note: string | null;
  transfer_group: string | null;
  count_line_id: string | null;
  recorded_by: string;
  occurred_at: string;
  created_at: string;
}

/** GET /api/admin/inventory — everything the stock screen draws. */
export interface InventoryOverview {
  areas: InventoryAreaRow[];
  categories: InventoryCategoryRow[];
  items: InventoryItemRow[];
  spots: InventorySpotRow[];
  stock: InventoryStockRow[];
  isAdmin: boolean;
}

/** GET /api/admin/inventory-movements — one page of the ledger. */
export interface InventoryLedgerPage {
  movements: InventoryMovementRow[];
  total: number;
  limit: number;
  offset: number;
  people: Record<string, string>;
}
