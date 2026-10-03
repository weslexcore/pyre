// Units for /admin/inventory (admins only): the configured list the item
// form's unit and lot drop-downs offer, each with its plural spelled out
// ("box" / "boxes"). POST adds one, PATCH renames, fixes the plural,
// re-orders, or retires one. Units are never deleted — items reference them —
// so "remove" is active=false; items keep a retired unit. Renaming a unit or
// fixing its plural carries to every item using it (a database trigger).

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { beginMutation, dbError, isUuid, json } from '@/lib/http/route';
import type { InventoryUnitRow } from '@/lib/inventory/types';
import { normalizeUnit } from '@/lib/inventory/validate';

const DUPLICATE = 'An active unit already has that name';

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, email, body } = ready;

  const normalized = normalizeUnit(body);
  if (!normalized.ok) return json({ error: normalized.error }, 400);

  // New units go to the end of the list unless placed explicitly.
  if (normalized.value.sort_order === undefined) {
    const { data: last } = await db
      .from('inventory_units')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    normalized.value.sort_order = ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1;
  }

  const { data, error } = await db
    .from('inventory_units')
    .insert({ ...normalized.value, created_by: email })
    .select('*')
    .single();
  if (error) return dbError(error, DUPLICATE);
  return json({ unit: data as InventoryUnitRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, body } = ready;

  const id = url.searchParams.get('id');
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const normalized = normalizeUnit(body, { partial: true });
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  if (Object.keys(normalized.value).length === 0) return json({ error: 'Nothing to update' }, 400);

  const { data, error } = await db
    .from('inventory_units')
    .update(normalized.value)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return dbError(error, DUPLICATE);
  if (!data) return json({ error: 'Unit not found' }, 404);
  return json({ unit: data as InventoryUnitRow });
};
