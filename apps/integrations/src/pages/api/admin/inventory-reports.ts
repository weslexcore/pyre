// Inventory reports for /admin/inventory/reports and the item pages.
//
//   GET ?from=&to=&groupBy=item|category|area → InventoryReport: usage vs
//       loss (waste, count shortfall), found stock and receipts for the
//       period, in units and dollars (default: the last 30 days, by item)
//   GET ?itemId=&days=                        → ItemHistory: one item's
//       stock over time (total across spots) for the last `days` days, with
//       the same figures for that window and where it sits now
//
// Gated on the /admin/inventory grant. The ledger is the source: these are
// sums of inventory_movements, valued at each movement's own unit cost.

import type { APIRoute } from 'astro';
import { beginRead, dbError, isUuid, json } from '@/lib/http/route';
import { addMovement, emptyFigures, stockSeries, summarize } from '@/lib/inventory/reports';
import {
  INVENTORY_HREF,
  type InventoryItemRow,
  type InventoryMovementRow,
  type InventoryOrderRow,
  type InventoryReport,
  type InventoryStockRow,
  type ItemHistory,
  type ReportGroup,
} from '@/lib/inventory/types';

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 731;
// A report reads at most this many movements; past it, it says so.
const REPORT_MAX_ROWS = 20_000;
const SERIES_MAX_ROWS = 5000;
const GROUPS: ReportGroup[] = ['item', 'category', 'area'];

const numeric = (m: InventoryMovementRow): InventoryMovementRow => ({
  ...m,
  quantity: Number(m.quantity),
});

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db } = ready;

  const itemId = url.searchParams.get('itemId');
  if (itemId) {
    if (!isUuid(itemId)) return json({ error: 'itemId must be a UUID' }, 400);
    const days = Math.min(
      Math.max(Number.parseInt(url.searchParams.get('days') ?? '', 10) || 90, 1),
      MAX_DAYS
    );
    const since = new Date(Date.now() - days * DAY_MS).toISOString();

    const [item, stock, movements, areas, openOrderResult] = await Promise.all([
      db.from('inventory_items').select('*').eq('id', itemId).maybeSingle(),
      db.from('inventory_stock').select('*').eq('item_id', itemId),
      db
        .from('inventory_movements')
        .select('*')
        .eq('item_id', itemId)
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: true })
        .limit(SERIES_MAX_ROWS),
      db.from('inventory_areas').select('id, name, sort_order'),
      db
        .from('inventory_orders')
        .select('*')
        .eq('item_id', itemId)
        .eq('status', 'ordered')
        .maybeSingle(),
    ]);
    for (const result of [item, stock, movements, areas, openOrderResult]) {
      if (result.error) return dbError(result.error);
    }
    if (!item.data) return json({ error: 'Item not found' }, 404);
    const row = item.data as InventoryItemRow;

    let category = '';
    if (row.category_id) {
      const { data } = await db
        .from('inventory_categories')
        .select('name')
        .eq('id', row.category_id)
        .maybeSingle();
      category = (data as { name: string } | null)?.name ?? '';
    }

    const areaInfo = new Map(
      ((areas.data ?? []) as { id: string; name: string; sort_order: number }[]).map((a) => [
        a.id,
        a,
      ])
    );
    const spots = ((stock.data ?? []) as InventoryStockRow[])
      .map((s) => ({
        areaId: s.area_id,
        areaName: areaInfo.get(s.area_id)?.name ?? 'Unknown area',
        quantity: Number(s.quantity),
        order: areaInfo.get(s.area_id)?.sort_order ?? 0,
      }))
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...spot }) => spot);
    const total = spots.reduce((sum, s) => sum + s.quantity, 0);

    const windowMovements = ((movements.data ?? []) as InventoryMovementRow[]).map(numeric);
    // The level at the start of the window: today's total, minus everything
    // logged since. (Moves between spots net to zero.)
    const startQty = total - windowMovements.reduce((sum, m) => sum + m.quantity, 0);
    const summary = emptyFigures();
    for (const m of windowMovements) addMovement(summary, m);

    const order = openOrderResult.data as InventoryOrderRow | null;
    const body: ItemHistory = {
      item: {
        ...row,
        lot_size: Number(row.lot_size),
        reorder_level: row.reorder_level == null ? null : Number(row.reorder_level),
        reorder_target: row.reorder_target == null ? null : Number(row.reorder_target),
      },
      category,
      spots,
      total,
      points: [
        { t: since, qty: Math.round(startQty * 100) / 100, type: 'initial', change: 0 },
        ...stockSeries(windowMovements, startQty),
      ],
      summary,
      openOrder: order ? { ...order, lots: Number(order.lots), units: Number(order.units) } : null,
      isAdmin: gate.access.isAdmin,
    };
    return json(body);
  }

  // The period report.
  const groupBy = (url.searchParams.get('groupBy') ?? 'item') as ReportGroup;
  if (!GROUPS.includes(groupBy)) {
    return json({ error: `groupBy must be one of: ${GROUPS.join(', ')}` }, 400);
  }
  const toParam = url.searchParams.get('to');
  const fromParam = url.searchParams.get('from');
  if (toParam && Number.isNaN(Date.parse(toParam)))
    return json({ error: 'to must be a date' }, 400);
  if (fromParam && Number.isNaN(Date.parse(fromParam))) {
    return json({ error: 'from must be a date' }, 400);
  }
  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - DEFAULT_DAYS * DAY_MS);
  if (from >= to) return json({ error: 'from must be before to' }, 400);
  if (to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) {
    return json({ error: 'Choose a period of two years or less' }, 400);
  }

  const [movements, items, categories, areas] = await Promise.all([
    db
      .from('inventory_movements')
      .select('item_id, area_id, movement_type, quantity, unit_cost_cents')
      .in('movement_type', ['use', 'waste', 'count_adjust', 'receive'])
      .gte('occurred_at', from.toISOString())
      .lt('occurred_at', to.toISOString())
      .limit(REPORT_MAX_ROWS),
    db.from('inventory_items').select('id, name, unit, category_id'),
    db.from('inventory_categories').select('id, name'),
    db.from('inventory_areas').select('id, name'),
  ]);
  for (const result of [movements, items, categories, areas]) {
    if (result.error) return dbError(result.error);
  }

  const rows = ((movements.data ?? []) as InventoryMovementRow[]).map(numeric);
  const { rows: reportRows, totals } = summarize(rows, groupBy, {
    items: new Map(
      (
        (items.data ?? []) as {
          id: string;
          name: string;
          unit: string;
          category_id: string | null;
        }[]
      ).map((i) => [i.id, i])
    ),
    categories: new Map(
      ((categories.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
    ),
    areas: new Map(
      ((areas.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name])
    ),
  });

  const body: InventoryReport = {
    from: from.toISOString(),
    to: to.toISOString(),
    groupBy,
    rows: reportRows,
    totals,
    truncated: rows.length >= REPORT_MAX_ROWS,
  };
  return json(body);
};
