// The inventory ledger API for /admin/inventory. GET reads the ledger
// newest-first with filters (or the whole filtered history as CSV with
// ?format=csv); POST logs one movement.
//
// Permissions: anyone granted /admin/inventory may log use, receive, waste,
// and moves between spots — that is the job of whoever is on shift. Opening
// balances and corrections are admin-only: they change stock without anything
// physically happening, so they are the setup and the fix-a-mistake paths.
// Count adjustments are never posted here; they come from the count screen.
//
// The ledger is append-only (a trigger enforces it), so there is no PATCH or
// DELETE: a mis-entry is fixed with a correction row.
//
// Identity (recorded_by) is always the session email, never the body. The
// unit cost is snapshotted from the item so historic loss keeps its price.

import type { APIRoute } from 'astro';
import { beginMutation, beginRead, dbError, isUuid, json } from '@/lib/http/route';
import { itemTotal, notifyIfLow } from '@/lib/inventory/alerts';
import { ledgerToCsv } from '@/lib/inventory/csv';
import { parseDelivery } from '@/lib/inventory/delivery';
import {
  formatUnits,
  lotsToUnits,
  parseQuantity,
  parseSignedQuantity,
  signedQuantity,
} from '@/lib/inventory/rules';
import {
  ADMIN_MOVEMENT_TYPES,
  INVENTORY_HREF,
  type InventoryLedgerPage,
  type InventoryMovementRow,
  isMovementType,
  MOVEMENT_TYPES,
  STAFF_MOVEMENT_TYPES,
} from '@/lib/inventory/types';
import { getPeopleNames } from '@/lib/sops/people';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
// One export holds the whole filtered history, but stays bounded.
const CSV_MAX_ROWS = 10_000;
const REASON_MAX = 120;
const NOTE_MAX = 1000;

/** The slice of a Supabase query builder the ledger filters use. */
interface Filterable<Q> {
  eq(column: string, value: string): Q;
  gte(column: string, value: string): Q;
  lt(column: string, value: string): Q;
}

const text = (raw: unknown, max: number): string | null =>
  typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, max) : null;

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { db } = ready;

  const itemId = url.searchParams.get('itemId');
  if (itemId && !isUuid(itemId)) return json({ error: 'itemId must be a UUID' }, 400);
  const areaId = url.searchParams.get('areaId');
  if (areaId && !isUuid(areaId)) return json({ error: 'areaId must be a UUID' }, 400);
  const type = url.searchParams.get('type');
  if (type && !isMovementType(type)) {
    return json({ error: `type must be one of: ${MOVEMENT_TYPES.join(', ')}` }, 400);
  }
  const since = url.searchParams.get('since');
  if (since && Number.isNaN(Date.parse(since))) return json({ error: 'since must be a date' }, 400);
  const until = url.searchParams.get('until');
  if (until && Number.isNaN(Date.parse(until))) return json({ error: 'until must be a date' }, 400);

  const filter = <Q extends Filterable<Q>>(query: Q): Q => {
    let q = query;
    if (itemId) q = q.eq('item_id', itemId);
    if (areaId) q = q.eq('area_id', areaId);
    if (type) q = q.eq('movement_type', type);
    if (since) q = q.gte('occurred_at', new Date(since).toISOString());
    if (until) q = q.lt('occurred_at', new Date(until).toISOString());
    return q;
  };

  if (url.searchParams.get('format') === 'csv') {
    const [{ data: rows, error }, { data: items }, { data: areas }] = await Promise.all([
      filter(
        db
          .from('inventory_movements')
          .select('*')
          .order('occurred_at', { ascending: true })
          .limit(CSV_MAX_ROWS)
      ),
      db.from('inventory_items').select('id, name, unit'),
      db.from('inventory_areas').select('id, name'),
    ]);
    if (error) return dbError(error);
    const csv = ledgerToCsv((rows ?? []) as InventoryMovementRow[], {
      itemNames: new Map(
        ((items ?? []) as { id: string; name: string; unit: string }[]).map((i) => [i.id, i])
      ),
      areaNames: new Map(
        ((areas ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name])
      ),
    });
    const filename = `inventory-history-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get('limit') ?? '', 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  const offset = Math.max(Number.parseInt(url.searchParams.get('offset') ?? '', 10) || 0, 0);

  const { data, error, count } = await filter(
    db
      .from('inventory_movements')
      .select('*', { count: 'exact' })
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
  );
  if (error) return dbError(error);

  const movements = ((data ?? []) as InventoryMovementRow[]).map((m) => ({
    ...m,
    quantity: Number(m.quantity),
  }));
  const people = await getPeopleNames(movements.map((m) => m.recorded_by));
  const body: InventoryLedgerPage = { movements, total: count ?? 0, limit, offset, people };
  return json(body);
};

interface ItemFacts {
  id: string;
  name: string;
  unit: string;
  unit_plural: string;
  lot_size: number;
  lot_label: string | null;
  lot_label_plural: string | null;
  unit_cost_cents: number | null;
  reorder_level: number | null;
  reorder_target: number | null;
  active: boolean;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db, email, body } = ready;

  const type = body.type;
  const isStaffType = (STAFF_MOVEMENT_TYPES as readonly unknown[]).includes(type);
  const isAdminType = (ADMIN_MOVEMENT_TYPES as readonly unknown[]).includes(type);
  if (!isStaffType && !isAdminType) {
    return json(
      {
        error: `type must be one of: ${[...STAFF_MOVEMENT_TYPES, ...ADMIN_MOVEMENT_TYPES].join(', ')}`,
      },
      400
    );
  }
  if (isAdminType && !gate.access.isAdmin) {
    return json({ error: 'Only admins can log opening balances and corrections' }, 403);
  }

  if (!isUuid(body.itemId)) return json({ error: 'itemId must be a UUID' }, 400);
  if (!isUuid(body.areaId)) return json({ error: 'areaId must be a UUID' }, 400);

  const [{ data: itemData, error: itemError }, { data: areaData, error: areaError }] =
    await Promise.all([
      db
        .from('inventory_items')
        .select(
          'id, name, unit, unit_plural, lot_size, lot_label, lot_label_plural, unit_cost_cents, reorder_level, reorder_target, active'
        )
        .eq('id', body.itemId)
        .maybeSingle(),
      db.from('inventory_areas').select('id, name, active').eq('id', body.areaId).maybeSingle(),
    ]);
  if (itemError) return dbError(itemError);
  if (areaError) return dbError(areaError);
  const item = itemData as ItemFacts | null;
  const area = areaData as { id: string; name: string; active: boolean } | null;
  if (!item?.active) return json({ error: 'Item not found' }, 404);
  if (!area?.active) return json({ error: 'Storage area not found' }, 404);

  // A delivery: the accepted part goes into stock, any rejects are recorded
  // (held for pickup, pending credit), and held rejects the driver took back
  // are marked picked up — one transaction (inventory_record_delivery).
  if (type === 'receive') {
    const delivery = parseDelivery(body, Number(item.lot_size));
    if (delivery instanceof Response) return delivery;
    const { data, error } = await db.rpc('inventory_record_delivery', {
      p_item_id: item.id,
      p_area_id: area.id,
      p_accepted: delivery.accepted,
      p_rejected: delivery.rejected,
      p_reasons: delivery.reasons,
      p_note: text(body.note, NOTE_MAX),
      p_order_id: null,
      p_pickup_ids: delivery.pickupIds,
      p_received_by: email,
    });
    if (error) {
      if (error.code === 'P0001') return json({ error: error.message }, 409);
      return dbError(error);
    }
    return json({ delivery: data }, 201);
  }

  // Amount: receiving may be entered in whole lots ("2 cases"); corrections
  // carry their own sign; everything else is a positive count of units.
  let amount: number | null;
  if (type === 'correction') {
    amount = parseSignedQuantity(body.quantity);
  } else if (type === 'receive' && body.lots != null) {
    const lots = parseQuantity(body.lots);
    amount = lots == null ? null : parseQuantity(lotsToUnits(lots, Number(item.lot_size)));
  } else {
    amount = parseQuantity(body.quantity);
  }
  if (amount == null) {
    return json(
      {
        error:
          type === 'correction'
            ? 'quantity must be a non-zero number'
            : 'quantity must be a number above 0',
      },
      400
    );
  }

  const reason = text(body.reason, REASON_MAX);
  const note = text(body.note, NOTE_MAX);
  if (type === 'waste' && !reason) return json({ error: 'Say why it was wasted' }, 400);
  if (type === 'correction' && !note) return json({ error: 'A correction needs a note' }, 400);

  const base = {
    item_id: item.id,
    unit_cost_cents: item.unit_cost_cents,
    reason,
    note,
    recorded_by: email,
  };

  let rows: Record<string, unknown>[];
  if (type === 'transfer') {
    if (!isUuid(body.toAreaId)) return json({ error: 'toAreaId must be a UUID' }, 400);
    if (body.toAreaId === area.id) return json({ error: 'Pick a different area to move to' }, 400);
    const { data: toArea, error: toError } = await db
      .from('inventory_areas')
      .select('id, active')
      .eq('id', body.toAreaId)
      .maybeSingle();
    if (toError) return dbError(toError);
    if (!toArea || !(toArea as { active: boolean }).active) {
      return json({ error: 'Destination area not found' }, 404);
    }
    const transferGroup = crypto.randomUUID();
    rows = [
      {
        ...base,
        area_id: area.id,
        movement_type: 'transfer',
        quantity: -amount,
        transfer_group: transferGroup,
      },
      {
        ...base,
        area_id: body.toAreaId,
        movement_type: 'transfer',
        quantity: amount,
        transfer_group: transferGroup,
      },
    ];
  } else {
    const quantity =
      type === 'correction'
        ? amount
        : signedQuantity(type as 'use' | 'waste' | 'receive' | 'initial', amount);
    rows = [{ ...base, area_id: area.id, movement_type: type, quantity }];
  }

  // Both legs of a move go in one statement, so they land or fail together.
  const { data, error } = await db.from('inventory_movements').insert(rows).select('*');
  if (error) {
    // The stock cache refuses to go below zero; tell the person what is
    // actually there (someone else may have just taken the last one).
    if (error.code === '23514' && error.message.includes('inventory_stock_quantity_check')) {
      const { data: stock } = await db
        .from('inventory_stock')
        .select('quantity')
        .eq('item_id', item.id)
        .eq('area_id', area.id)
        .maybeSingle();
      const onHand = Number((stock as { quantity: number } | null)?.quantity ?? 0);
      return json(
        {
          error: `Only ${formatUnits(onHand, item)} on hand in ${area.name}. Count it if that's wrong.`,
          onHand,
        },
        409
      );
    }
    return dbError(error);
  }

  const saved = ((data ?? []) as InventoryMovementRow[]).map((m) => ({
    ...m,
    quantity: Number(m.quantity),
  }));

  // Did this take the item to its re-order level? (A move between spots
  // nets to zero and never does.) Best-effort; never fails the save.
  const change = saved.reduce((sum, m) => sum + m.quantity, 0);
  if (change < 0 && item.reorder_level != null) {
    const after = await itemTotal(db, item.id);
    if (after != null) await notifyIfLow(db, item, after - change, after, email);
  }

  return json({ movements: saved }, 201);
};
