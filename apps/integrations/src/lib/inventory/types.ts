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
  /** The re-order a receive came from; null for an ad-hoc receive. */
  order_id?: string | null;
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

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

export const COUNTS_HREF = '/admin/inventory/count';

export type CountStatus = 'open' | 'closed' | 'cancelled';
export type ReviewStatus = 'none' | 'pending' | 'accepted' | 'recount';

/** A count round: groups lines across areas; can stay open for days. */
export interface InventoryCountRow {
  id: string;
  name: string;
  area_ids: string[];
  status: CountStatus;
  started_by: string;
  started_at: string;
  closed_by: string | null;
  closed_at: string | null;
}

/** One counted spot, saved through inventory_record_count. */
export interface InventoryCountLineRow {
  id: string;
  count_id: string | null;
  item_id: string;
  area_id: string;
  counted_qty: number;
  expected_qty: number;
  variance: number;
  variance_cents: number | null;
  counted_by: string;
  counted_at: string;
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface InventorySettings {
  /** A line goes to review when off by more than this percent... */
  review_pct: number;
  /** ...or by more than this many cents. */
  review_cents: number;
}

export type AreaDueStatus = 'overdue' | 'due' | 'ok' | 'unscheduled';

/** GET /api/admin/inventory-counts — the Count tab's home. */
export interface CountsOverview {
  areas: {
    area: InventoryAreaRow;
    lastCountedAt: string | null;
    status: AreaDueStatus;
    /** Active items placed here. */
    spotCount: number;
  }[];
  rounds: {
    round: InventoryCountRow;
    counted: number;
    total: number;
    people: string[];
  }[];
  /** Admins only: lines waiting on a decision. */
  review: (InventoryCountLineRow & { itemName: string; unit: string; areaName: string })[];
  settings: InventorySettings;
  people: Record<string, string>;
  isAdmin: boolean;
}

/**
 * One row on the counting screen. Blind until counted: `line` is null for a
 * spot nobody has counted yet in this round (or this one-off session), and
 * nothing about the expected quantity is sent for it.
 */
export interface CountSheetRow {
  itemId: string;
  name: string;
  unit: string;
  category: string;
  line: InventoryCountLineRow | null;
  /** An admin asked for this spot to be counted again (in any round). */
  recountAsked: boolean;
}

/** GET /api/admin/inventory-counts?areaId=… — the counting screen. */
export interface CountSheet {
  area: InventoryAreaRow;
  round: InventoryCountRow | null;
  rows: CountSheetRow[];
  people: Record<string, string>;
}

/** GET /api/admin/inventory-counts?summary=<countId> — a round's results. */
export interface CountSummary {
  round: InventoryCountRow;
  areas: { area: InventoryAreaRow; counted: number; total: number }[];
  lines: (InventoryCountLineRow & { itemName: string; unit: string; areaName: string })[];
  notCounted: { itemName: string; areaName: string }[];
  totals: { shortUnits: number; shortCents: number; foundUnits: number; foundCents: number };
  people: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Re-ordering
// ---------------------------------------------------------------------------

export const REORDER_HREF = '/admin/inventory/reorder';

export type OrderStatus = 'ordered' | 'received' | 'cancelled';

export interface InventoryOrderRow {
  id: string;
  item_id: string;
  lots: number;
  units: number;
  unit_cost_cents: number | null;
  status: OrderStatus;
  note: string | null;
  ordered_by: string;
  ordered_at: string;
  received_by: string | null;
  received_at: string | null;
  received_units: number | null;
  received_area_id: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
}

/** One item on the "needs ordering" list. */
export interface ReorderLine {
  item: InventoryItemRow;
  category: string;
  /** Total on hand across every spot. */
  total: number;
  suggestedLots: number;
  suggestedUnits: number;
  /** suggestedUnits at the item's unit cost; null without a cost. */
  estimateCents: number | null;
}

/** GET /api/admin/inventory-orders — the Re-order tab. */
export interface ReorderOverview {
  /** At or below the re-order level, with nothing on order. */
  needed: ReorderLine[];
  /** Open orders, oldest first, with the item they are for. */
  open: (InventoryOrderRow & { item: InventoryItemRow; total: number })[];
  /** Received or cancelled in the last 30 days, newest first. */
  recent: (InventoryOrderRow & { itemName: string; unit: string; areaName: string | null })[];
  /** Active areas, for choosing where a delivery goes. */
  areas: InventoryAreaRow[];
  people: Record<string, string>;
  isAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type ReportGroup = 'item' | 'category' | 'area';

/** Usage, loss, and inflow for one group over a period, in units and cents. */
export interface ReportRow {
  key: string;
  label: string;
  /** Item reports only: the unit and id, for linking to the item page. */
  unit?: string;
  itemId?: string;
  used: number;
  usedCents: number;
  wasted: number;
  wastedCents: number;
  short: number;
  shortCents: number;
  found: number;
  foundCents: number;
  received: number;
  receivedCents: number;
}

/** GET /api/admin/inventory-reports — the Reports tab. */
export interface InventoryReport {
  from: string;
  to: string;
  groupBy: ReportGroup;
  rows: ReportRow[];
  totals: Omit<ReportRow, 'key' | 'label' | 'unit' | 'itemId'>;
  /** True when the period held more movements than one report reads. */
  truncated: boolean;
}

/** One point on an item's stock-over-time line. */
export interface StockPoint {
  /** ISO time of the movement that set this level. */
  t: string;
  /** Total on hand across every spot right after it. */
  qty: number;
  type: MovementType;
  change: number;
}

/** GET /api/admin/inventory-reports?itemId=… — the item page. */
export interface ItemHistory {
  item: InventoryItemRow;
  category: string;
  /** Per-spot on hand now. */
  spots: { areaId: string; areaName: string; quantity: number }[];
  total: number;
  points: StockPoint[];
  /** The same window's usage and loss, for the summary tiles. */
  summary: Omit<ReportRow, 'key' | 'label' | 'unit' | 'itemId'>;
  openOrder: InventoryOrderRow | null;
  isAdmin: boolean;
}
