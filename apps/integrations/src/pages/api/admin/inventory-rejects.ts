// Rejected deliveries API for the /admin/inventory/rejects tab and the
// receive forms.
//
//   GET                    → RejectsOverview: held for pickup, pending credit,
//                            decided in the last 90 days, and the items that
//                            have had rejects (for the chart's picker)
//   GET ?heldFor=<itemId>  → { held }: that item's rejects still on site — the
//                            receive form asks whether the driver took them
//   GET ?itemId=&weeks=    → RejectSeries: delivered vs rejected per studio
//                            week (Monday–Sunday) for one item
//   PATCH {action:'pickup', ids}            → the vendor took them back
//   PATCH {action:'credit', id, cents, note} → credited (admins)
//   PATCH {action:'deny', id, note}          → credit denied (admins)
//   PATCH {action:'reopen', id}              → back to pending (admins)
//
// Gated on the /admin/inventory grant; credit decisions are admin-only.
// Identity (picked_up_by, credited_by) is always the session email.

import type { APIRoute } from 'astro';
import { beginMutation, beginRead, dbError, isUuid, json } from '@/lib/http/route';
import { weeklyRejects } from '@/lib/inventory/rejects';
import {
  INVENTORY_HREF,
  type InventoryRejectRow,
  type RejectSeries,
  type RejectsOverview,
  type RejectView,
} from '@/lib/inventory/types';
import { getPeopleNames } from '@/lib/sops/people';

const DAY_MS = 86_400_000;
const DECIDED_DAYS = 90;
const MAX_WEEKS = 104;
const LIST_LIMIT = 300;
const NOTE_MAX = 500;

const numeric = (r: InventoryRejectRow): InventoryRejectRow => ({
  ...r,
  delivered_qty: Number(r.delivered_qty),
  rejected_qty: Number(r.rejected_qty),
});

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db } = ready;

  const heldFor = url.searchParams.get('heldFor');
  if (heldFor) {
    if (!isUuid(heldFor)) return json({ error: 'heldFor must be an item id' }, 400);
    const { data, error } = await db
      .from('inventory_rejects')
      .select('*')
      .eq('item_id', heldFor)
      .is('picked_up_at', null)
      .order('received_at', { ascending: true });
    if (error) return dbError(error);
    return json({ held: ((data ?? []) as InventoryRejectRow[]).map(numeric) });
  }

  const itemId = url.searchParams.get('itemId');
  if (itemId) {
    if (!isUuid(itemId)) return json({ error: 'itemId must be a UUID' }, 400);
    const weeks = Math.min(
      Math.max(Number.parseInt(url.searchParams.get('weeks') ?? '', 10) || 12, 1),
      MAX_WEEKS
    );
    // A day's margin before the first Monday: weekStart() keeps only what
    // falls inside the window.
    const since = new Date(Date.now() - (weeks * 7 + 1) * DAY_MS).toISOString();
    const [item, receipts, rejects] = await Promise.all([
      db
        .from('inventory_items')
        .select('id, name, unit, unit_plural')
        .eq('id', itemId)
        .maybeSingle(),
      db
        .from('inventory_movements')
        .select('occurred_at, quantity')
        .eq('item_id', itemId)
        .eq('movement_type', 'receive')
        .gte('occurred_at', since)
        .limit(5000),
      db
        .from('inventory_rejects')
        .select('received_at, rejected_qty, unit_cost_cents')
        .eq('item_id', itemId)
        .gte('received_at', since)
        .limit(5000),
    ]);
    for (const result of [item, receipts, rejects]) {
      if (result.error) return dbError(result.error);
    }
    if (!item.data) return json({ error: 'Item not found' }, 404);
    const row = item.data as { id: string; name: string; unit: string; unit_plural: string };
    const body: RejectSeries = {
      itemId: row.id,
      name: row.name,
      unit: row.unit,
      unit_plural: row.unit_plural,
      weeks: weeklyRejects(
        (receipts.data ?? []) as { occurred_at: string; quantity: number }[],
        (rejects.data ?? []) as {
          received_at: string;
          rejected_qty: number;
          unit_cost_cents: number | null;
        }[],
        weeks,
        new Date()
      ),
    };
    return json(body);
  }

  const decidedSince = new Date(Date.now() - DECIDED_DAYS * DAY_MS).toISOString();
  const [held, pending, decided, counts, items] = await Promise.all([
    db
      .from('inventory_rejects')
      .select('*')
      .is('picked_up_at', null)
      .order('received_at', { ascending: true })
      .limit(LIST_LIMIT),
    db
      .from('inventory_rejects')
      .select('*')
      .eq('credit_status', 'pending')
      .order('received_at', { ascending: true })
      .limit(LIST_LIMIT),
    db
      .from('inventory_rejects')
      .select('*')
      .neq('credit_status', 'pending')
      .gte('credited_at', decidedSince)
      .order('credited_at', { ascending: false })
      .limit(LIST_LIMIT),
    db.from('inventory_rejects').select('item_id, rejected_qty').limit(20_000),
    db.from('inventory_items').select('id, name, unit, unit_plural'),
  ]);
  for (const result of [held, pending, decided, counts, items]) {
    if (result.error) return dbError(result.error);
  }

  const itemById = new Map(
    ((items.data ?? []) as { id: string; name: string; unit: string; unit_plural: string }[]).map(
      (i) => [i.id, i]
    )
  );
  const view = (r: InventoryRejectRow): RejectView => {
    const item = itemById.get(r.item_id);
    return {
      ...numeric(r),
      itemName: item?.name ?? 'Retired item',
      unit: item?.unit ?? '',
      unit_plural: item?.unit_plural ?? '',
    };
  };

  const totals = new Map<string, number>();
  for (const r of (counts.data ?? []) as { item_id: string; rejected_qty: number }[]) {
    totals.set(r.item_id, (totals.get(r.item_id) ?? 0) + Number(r.rejected_qty));
  }

  const body: RejectsOverview = {
    held: ((held.data ?? []) as InventoryRejectRow[]).map(view),
    pendingCredit: ((pending.data ?? []) as InventoryRejectRow[]).map(view),
    decided: ((decided.data ?? []) as InventoryRejectRow[]).map(view),
    items: [...totals.entries()]
      .map(([id, rejected]) => ({
        id,
        name: itemById.get(id)?.name ?? 'Retired item',
        unit: itemById.get(id)?.unit ?? '',
        unit_plural: itemById.get(id)?.unit_plural ?? '',
        rejected,
      }))
      .sort((a, b) => b.rejected - a.rejected || a.name.localeCompare(b.name)),
    people: {},
    isAdmin: gate.access.isAdmin,
  };
  body.people = await getPeopleNames(
    [...body.held, ...body.pendingCredit, ...body.decided].flatMap((r) => [
      r.received_by,
      r.picked_up_by ?? '',
      r.credited_by ?? '',
    ])
  );
  return json(body);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db, email, body } = ready;
  const now = new Date().toISOString();
  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, NOTE_MAX) : null;

  if (body.action === 'pickup') {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length === 0 || ids.length > 100 || !ids.every(isUuid)) {
      return json({ error: 'ids must be reject ids' }, 400);
    }
    const { data, error } = await db
      .from('inventory_rejects')
      .update({ picked_up_at: now, picked_up_by: email })
      .in('id', ids as string[])
      .is('picked_up_at', null)
      .select('id');
    if (error) return dbError(error);
    return json({ updated: (data ?? []).length });
  }

  if (!gate.access.isAdmin) return json({ error: 'Only admins can record credits' }, 403);
  if (!isUuid(body.id)) return json({ error: 'id must be a UUID' }, 400);

  let patch: Record<string, unknown>;
  if (body.action === 'credit') {
    const cents = Number(body.cents);
    if (!Number.isInteger(cents) || cents < 0 || cents > 100_000_000) {
      return json({ error: 'Enter the credit amount' }, 400);
    }
    patch = {
      credit_status: 'credited',
      credit_cents: cents,
      credit_note: note,
      credited_by: email,
      credited_at: now,
    };
  } else if (body.action === 'deny') {
    patch = {
      credit_status: 'denied',
      credit_cents: null,
      credit_note: note,
      credited_by: email,
      credited_at: now,
    };
  } else if (body.action === 'reopen') {
    patch = {
      credit_status: 'pending',
      credit_cents: null,
      credit_note: null,
      credited_by: null,
      credited_at: null,
    };
  } else {
    return json({ error: "action must be 'pickup', 'credit', 'deny', or 'reopen'" }, 400);
  }

  const { data, error } = await db
    .from('inventory_rejects')
    .update(patch)
    .eq('id', body.id)
    .select('*')
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return json({ error: 'Reject not found' }, 404);
  return json({ reject: numeric(data as InventoryRejectRow) });
};
