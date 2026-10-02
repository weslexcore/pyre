// Where items live, for /admin/inventory (admins only): POST places an item
// in another area, PATCH sets its shelf order or par level there, DELETE takes
// it off that area's walk — only once nothing is on hand there, so stock can
// never be hidden by removing the spot that holds it (move or count it out
// first). The spot's history stays in the ledger either way.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { beginDelete, beginMutation, dbError, isUuid, json } from '@/lib/http/route';
import { formatUnits } from '@/lib/inventory/rules';
import type { InventorySpotRow } from '@/lib/inventory/types';

function spotFields(body: Record<string, unknown>): Record<string, number | null> | string {
  const out: Record<string, number | null> = {};
  if ('sortOrder' in body) {
    if (typeof body.sortOrder !== 'number' || !Number.isInteger(body.sortOrder)) {
      return 'sortOrder must be a whole number';
    }
    out.sort_order = body.sortOrder;
  }
  if ('parLevel' in body) {
    const par = body.parLevel;
    if (par == null || par === '') out.par_level = null;
    else if (typeof par !== 'number' || !Number.isFinite(par) || par < 0) {
      return 'parLevel must be a number ≥ 0 or empty';
    } else out.par_level = par;
  }
  return out;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, body } = ready;

  if (!isUuid(body.itemId)) return json({ error: 'itemId must be a UUID' }, 400);
  if (!isUuid(body.areaId)) return json({ error: 'areaId must be a UUID' }, 400);
  const fields = spotFields(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);

  const { data, error } = await db
    .from('inventory_item_spots')
    .insert({ item_id: body.itemId, area_id: body.areaId, ...fields })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23503') return json({ error: 'Item or area not found' }, 404);
    return dbError(error, 'That item is already in that area');
  }
  return json({ spot: data as InventorySpotRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, body } = ready;

  const id = url.searchParams.get('id');
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);
  const fields = spotFields(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);
  if (Object.keys(fields).length === 0) return json({ error: 'Nothing to update' }, 400);

  const { data, error } = await db
    .from('inventory_item_spots')
    .update(fields)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return json({ error: 'Spot not found' }, 404);
  return json({ spot: data as InventorySpotRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db } = ready;

  const id = url.searchParams.get('id');
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data: spot, error } = await db
    .from('inventory_item_spots')
    .select('id, item_id, area_id')
    .eq('id', id)
    .maybeSingle();
  if (error) return dbError(error);
  if (!spot) return json({ error: 'Spot not found' }, 404);
  const { item_id, area_id } = spot as { item_id: string; area_id: string };

  const [{ data: stock }, { data: item }] = await Promise.all([
    db
      .from('inventory_stock')
      .select('quantity')
      .eq('item_id', item_id)
      .eq('area_id', area_id)
      .maybeSingle(),
    db.from('inventory_items').select('unit').eq('id', item_id).maybeSingle(),
  ]);
  const onHand = Number((stock as { quantity: number } | null)?.quantity ?? 0);
  if (onHand > 0) {
    const unit = (item as { unit: string } | null)?.unit ?? 'unit';
    return json(
      { error: `${formatUnits(onHand, unit)} still here — move or count them out first` },
      409
    );
  }

  const { error: deleteError } = await db.from('inventory_item_spots').delete().eq('id', id);
  if (deleteError) return dbError(deleteError);
  return json({ ok: true });
};
