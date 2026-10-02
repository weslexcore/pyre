// Item categories for /admin/inventory (admins only): the configured list
// the item form's drop-down offers. POST adds one, PATCH renames, re-orders,
// or retires one. Categories are never deleted — items reference them — so
// "remove" is active=false; items keep showing a retired category's name.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { beginMutation, dbError, isUuid, json } from '@/lib/http/route';
import type { InventoryCategoryRow } from '@/lib/inventory/types';
import { normalizeCategory } from '@/lib/inventory/validate';

const DUPLICATE = 'An active category already has that name';

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, email, body } = ready;

  const normalized = normalizeCategory(body);
  if (!normalized.ok) return json({ error: normalized.error }, 400);

  // New categories go to the end of the list unless placed explicitly.
  if (normalized.value.sort_order === undefined) {
    const { data: last } = await db
      .from('inventory_categories')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    normalized.value.sort_order = ((last as { sort_order: number } | null)?.sort_order ?? 0) + 1;
  }

  const { data, error } = await db
    .from('inventory_categories')
    .insert({ ...normalized.value, created_by: email })
    .select('*')
    .single();
  if (error) return dbError(error, DUPLICATE);
  return json({ category: data as InventoryCategoryRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, body } = ready;

  const id = url.searchParams.get('id');
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const normalized = normalizeCategory(body, { partial: true });
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  if (Object.keys(normalized.value).length === 0) return json({ error: 'Nothing to update' }, 400);

  const { data, error } = await db
    .from('inventory_categories')
    .update(normalized.value)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return dbError(error, DUPLICATE);
  if (!data) return json({ error: 'Category not found' }, 404);
  return json({ category: data as InventoryCategoryRow });
};
