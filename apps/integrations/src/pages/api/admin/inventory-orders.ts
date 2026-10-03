// Re-ordering API for the /admin/inventory/reorder tab.
//
//   GET                    → ReorderOverview: items at or below their re-order
//                            level with nothing on order (with a suggested
//                            number of whole lots), the open orders, and the
//                            last 30 days of received/cancelled ones
//   POST                   → mark an item ordered (admins)
//   PATCH {action:'receive'} → the delivery arrived: put it in an area, which
//                            posts the receive to the ledger (anyone with the
//                            page — whoever unpacks it)
//   PATCH {action:'cancel'}  → it is not coming (admins)
//
// Identity (ordered_by, received_by, cancelled_by) is the session email.

import type { APIRoute } from 'astro';
import { beginMutation, beginRead, dbError, isUuid, json } from '@/lib/http/route';
import { parseDelivery } from '@/lib/inventory/delivery';
import {
  isLowStock,
  lotsToUnits,
  parseQuantity,
  suggestedLots,
  totalsByItem,
} from '@/lib/inventory/rules';
import {
  INVENTORY_HREF,
  type InventoryAreaRow,
  type InventoryItemRow,
  type InventoryOrderRow,
  type InventoryStockRow,
  type ReorderLine,
  type ReorderOverview,
} from '@/lib/inventory/types';
import { getPeopleNames } from '@/lib/sops/people';

const RECENT_DAYS = 30;
const NOTE_MAX = 500;

const numericItem = (i: InventoryItemRow): InventoryItemRow => ({
  ...i,
  lot_size: Number(i.lot_size),
  reorder_level: i.reorder_level == null ? null : Number(i.reorder_level),
  reorder_target: i.reorder_target == null ? null : Number(i.reorder_target),
});

const numericOrder = (o: InventoryOrderRow): InventoryOrderRow => ({
  ...o,
  lots: Number(o.lots),
  units: Number(o.units),
  received_units: o.received_units == null ? null : Number(o.received_units),
});

export const GET: APIRoute = async ({ cookies }) => {
  const ready = await beginRead(cookies, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db } = ready;

  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
  const [items, categories, stock, areas, open, recent] = await Promise.all([
    db.from('inventory_items').select('*'),
    db.from('inventory_categories').select('id, name'),
    db.from('inventory_stock').select('*'),
    db.from('inventory_areas').select('*').order('sort_order').order('name'),
    db.from('inventory_orders').select('*').eq('status', 'ordered').order('ordered_at'),
    db
      .from('inventory_orders')
      .select('*')
      .neq('status', 'ordered')
      .or(`received_at.gte.${since},cancelled_at.gte.${since}`)
      .order('ordered_at', { ascending: false })
      .limit(50),
  ]);
  for (const result of [items, categories, stock, areas, open, recent]) {
    if (result.error) return dbError(result.error);
  }

  const allItems = ((items.data ?? []) as InventoryItemRow[]).map(numericItem);
  const itemById = new Map(allItems.map((i) => [i.id, i]));
  const categoryName = new Map(
    ((categories.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
  );
  const totals = totalsByItem(
    ((stock.data ?? []) as InventoryStockRow[]).map((s) => ({ ...s, quantity: Number(s.quantity) }))
  );
  const allAreas = (areas.data ?? []) as InventoryAreaRow[];
  const openOrders = ((open.data ?? []) as InventoryOrderRow[]).map(numericOrder);
  const onOrder = new Set(openOrders.map((o) => o.item_id));

  const needed: ReorderLine[] = allItems
    .filter((item) => item.active && !onOrder.has(item.id))
    .map((item) => ({ item, total: totals.get(item.id) ?? 0 }))
    .filter(({ item, total }) => isLowStock(item, total))
    .map(({ item, total }) => {
      const lots = suggestedLots(item, total) ?? 1;
      const units = lotsToUnits(lots, item.lot_size);
      return {
        item,
        category: item.category_id ? (categoryName.get(item.category_id) ?? '') : '',
        total,
        suggestedLots: lots,
        suggestedUnits: units,
        estimateCents:
          item.unit_cost_cents == null ? null : Math.round(units * item.unit_cost_cents),
      };
    })
    // Emptiest first, relative to its own re-order level.
    .sort(
      (a, b) =>
        a.total / Math.max(1, a.item.reorder_level ?? 1) -
          b.total / Math.max(1, b.item.reorder_level ?? 1) || a.item.name.localeCompare(b.item.name)
    );

  const body: ReorderOverview = {
    needed,
    open: openOrders
      .filter((o) => itemById.has(o.item_id))
      .map((o) => ({
        ...o,
        item: itemById.get(o.item_id) as InventoryItemRow,
        total: totals.get(o.item_id) ?? 0,
      })),
    recent: ((recent.data ?? []) as InventoryOrderRow[]).map((o) => {
      const item = itemById.get(o.item_id);
      return {
        ...numericOrder(o),
        itemName: item?.name ?? 'Retired item',
        unit: item?.unit ?? '',
        areaName: o.received_area_id
          ? (allAreas.find((a) => a.id === o.received_area_id)?.name ?? null)
          : null,
      };
    }),
    areas: allAreas.filter((a) => a.active),
    people: {},
    isAdmin: gate.access.isAdmin,
  };
  body.people = await getPeopleNames([
    ...body.open.map((o) => o.ordered_by),
    ...body.recent.flatMap((o) => [o.ordered_by, o.received_by ?? '', o.cancelled_by ?? '']),
  ]);
  return json(body);
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db, email, body } = ready;
  if (!gate.access.isAdmin) return json({ error: 'Only admins can place orders' }, 403);

  if (!isUuid(body.itemId)) return json({ error: 'itemId must be a UUID' }, 400);
  const lots = parseQuantity(body.lots);
  if (lots == null) return json({ error: 'Enter how many lots were ordered' }, 400);
  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, NOTE_MAX) : null;

  const { data: itemData, error: itemError } = await db
    .from('inventory_items')
    .select('*')
    .eq('id', body.itemId)
    .maybeSingle();
  if (itemError) return dbError(itemError);
  const item = itemData ? numericItem(itemData as InventoryItemRow) : null;
  if (!item?.active) return json({ error: 'Item not found' }, 404);

  const units = parseQuantity(lotsToUnits(lots, item.lot_size));
  if (units == null) return json({ error: 'That order is too large' }, 400);

  const { data, error } = await db
    .from('inventory_orders')
    .insert({
      item_id: item.id,
      lots,
      units,
      unit_cost_cents: item.unit_cost_cents,
      note,
      ordered_by: email,
    })
    .select('*')
    .single();
  if (error) return dbError(error, `${item.name} is already on order`);
  return json({ order: numericOrder(data as InventoryOrderRow) }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db, email, body } = ready;
  if (!isUuid(body.id)) return json({ error: 'id must be a UUID' }, 400);

  if (body.action === 'receive') {
    if (!isUuid(body.areaId)) return json({ error: 'Choose where it was put away' }, 400);
    const { data: orderData, error: orderError } = await db
      .from('inventory_orders')
      .select('id, item_id, inventory_items(lot_size)')
      .eq('id', body.id)
      .maybeSingle();
    if (orderError) return dbError(orderError);
    if (!orderData) return json({ error: 'Order not found' }, 404);
    const order = orderData as unknown as {
      id: string;
      item_id: string;
      inventory_items: { lot_size: number } | null;
    };

    // `units` is what was accepted; rejects (with their reasons) and the held
    // rejects the driver took back come in the same body as on the stock
    // screen's Receive.
    const delivery = parseDelivery(
      { ...body, quantity: body.units },
      Number(order.inventory_items?.lot_size ?? 1)
    );
    if (delivery instanceof Response) return delivery;
    const { data, error } = await db.rpc('inventory_record_delivery', {
      p_item_id: order.item_id,
      p_area_id: body.areaId,
      p_accepted: delivery.accepted,
      p_rejected: delivery.rejected,
      p_reasons: delivery.reasons,
      p_note: null,
      p_order_id: order.id,
      p_pickup_ids: delivery.pickupIds,
      p_received_by: email,
    });
    if (error) {
      if (error.code === 'P0001') return json({ error: error.message }, 409);
      return dbError(error);
    }
    return json({ delivery: data });
  }

  if (body.action === 'cancel') {
    if (!gate.access.isAdmin) return json({ error: 'Only admins can cancel an order' }, 403);
    const { data, error } = await db
      .from('inventory_orders')
      .update({ status: 'cancelled', cancelled_by: email, cancelled_at: new Date().toISOString() })
      .eq('id', body.id)
      .eq('status', 'ordered')
      .select('*')
      .maybeSingle();
    if (error) return dbError(error);
    if (!data) return json({ error: 'That order is not open' }, 409);
    return json({ order: numericOrder(data as InventoryOrderRow) });
  }

  return json({ error: "action must be 'receive' or 'cancel'" }, 400);
};
