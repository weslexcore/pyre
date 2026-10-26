// The inventory list for /admin/inventory.
//
//   GET                      → InventoryResponse (the whole list — it is small)
//   POST                     → add an item (admins)
//   PATCH ?id=<uuid>         → edit an item. Anyone with the page may set
//                              in_stock; every other field is admins only.
//                              Any edit counts as a look at the item: it
//                              stamps last_counted_at / _by.
//   DELETE ?id=<uuid>        → remove an item (admins)
//
// Gated on the /admin/inventory page grant; requireAdmin on top for setup.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { beginDelete, beginMutation, beginRead, dbError, isUuid, json } from '@/lib/http/route';
import { notifyIfLow } from '@/lib/inventory/alerts';
import { normalizeFields } from '@/lib/inventory/rules';
import { INVENTORY_HREF, type InventoryResponse, type InventoryRow } from '@/lib/inventory/types';
import { getPeopleNames } from '@/lib/sops/people';

const DUPLICATE = 'An item already has that name';

// PostgREST returns `numeric` as strings when they don't fit a JS number
// exactly; normalise so the island can do arithmetic.
function numericRow(row: InventoryRow): InventoryRow {
  return {
    ...row,
    in_stock: Number(row.in_stock),
    reorder_at: row.reorder_at == null ? null : Number(row.reorder_at),
  };
}

export const GET: APIRoute = async ({ cookies }) => {
  const ready = await beginRead(cookies, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db } = ready;

  const { data, error } = await db.from('inventory').select('*').order('name');
  if (error) return dbError(error);
  const items = ((data ?? []) as InventoryRow[]).map(numericRow);
  const people = await getPeopleNames(
    items.map((i) => i.last_counted_by).filter((e): e is string => !!e)
  );
  const body: InventoryResponse = { items, people, isAdmin: gate.access.isAdmin };
  return json(body);
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, email, body } = ready;

  const normalized = normalizeFields(body);
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  const { data, error } = await db
    .from('inventory')
    .insert({
      ...normalized.value,
      created_by: email,
      // An item added with a number in stock has just been counted.
      ...(normalized.value.in_stock
        ? { last_counted_at: new Date().toISOString(), last_counted_by: email }
        : {}),
    })
    .select('*')
    .single();
  if (error) return dbError(error, DUPLICATE);
  return json({ item: numericRow(data as InventoryRow) }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginMutation(cookies, request, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db, email, body } = ready;

  const id = url.searchParams.get('id');
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const normalized = normalizeFields(body, { partial: true });
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  const changes = normalized.value;
  if (Object.keys(changes).length === 0) {
    return json({ error: 'Nothing to update' }, 400);
  }
  if (!gate.access.isAdmin && Object.keys(changes).some((key) => key !== 'in_stock')) {
    return json({ error: 'Only admins can change item details' }, 403);
  }

  const { data: beforeData, error: beforeError } = await db
    .from('inventory')
    .select('in_stock')
    .eq('id', id)
    .maybeSingle();
  if (beforeError) return dbError(beforeError);
  if (!beforeData) return json({ error: 'Item not found' }, 404);

  const { data, error } = await db
    .from('inventory')
    .update({
      ...changes,
      last_counted_at: new Date().toISOString(),
      last_counted_by: email,
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return dbError(error, DUPLICATE);
  if (!data) return json({ error: 'Item not found' }, 404);
  const item = numericRow(data as InventoryRow);

  if ('in_stock' in changes || 'reorder_at' in changes) {
    await notifyIfLow(
      db,
      item,
      Number((beforeData as { in_stock: number }).in_stock),
      item.in_stock,
      email
    );
  }
  const people = await getPeopleNames([email]);
  return json({ item, people });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db } = ready;

  const id = url.searchParams.get('id');
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);
  const { data, error } = await db.from('inventory').delete().eq('id', id).select('id');
  if (error) return dbError(error);
  if ((data ?? []).length === 0) return json({ error: 'Item not found' }, 404);
  return json({ ok: true });
};
