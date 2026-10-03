// Products with variants for /admin/inventory (admins only): one product
// ("Pyre Tee") whose variants ("S", "M", "L") are each an inventory item with
// its own stock and re-order level.
//
//   POST { name, categoryId, variants, spots, ...item settings }
//        adds a product and all its variants, sharing the item settings
//        (unit, lot, re-order levels, cost, vendor) and kept in the areas in
//        `spots` with nothing on hand — one transaction
//        (inventory_create_product). Stock goes in with Receive or a count.
//   POST { productId, variant }
//        adds one more variant, copying its siblings' settings and areas
//        (inventory_add_variant).
//   PATCH ?id= { name?, categoryId?, active? }
//        renames, re-categorises, or retires a product; its variants follow.
//
// A single variant is edited, re-ordered, or retired through inventory-items
// like any other item.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { beginMutation, type Db, dbError, isUuid, json } from '@/lib/http/route';
import type { InventoryProductRow } from '@/lib/inventory/types';
import { checkUnits } from '@/lib/inventory/units';
import { normalizeItem, normalizeProduct, parseVariants } from '@/lib/inventory/validate';

const DUPLICATE = 'Something active already has that name';
const DUPLICATE_VARIANT = 'This product already has a variant with that name';
const MAX_SPOTS = 20;

/** The item columns a new product's variants share. */
const SHARED_COLUMNS = [
  'unit_id',
  'lot_size',
  'lot_unit_id',
  'reorder_level',
  'reorder_target',
  'unit_cost_cents',
  'vendor',
  'vendor_url',
  'notes',
] as const;

/** A chosen category must exist and be active. Null when fine (or none). */
async function checkCategory(db: Db, categoryId: unknown): Promise<Response | null> {
  if (typeof categoryId !== 'string') return null;
  const { data, error } = await db
    .from('inventory_categories')
    .select('active')
    .eq('id', categoryId)
    .maybeSingle();
  if (error) return dbError(error);
  if (!(data as { active: boolean } | null)?.active) {
    return json({ error: 'That category no longer exists' }, 400);
  }
  return null;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, email, body } = ready;

  if (body.productId != null) {
    if (!isUuid(body.productId)) return json({ error: 'productId must be a UUID' }, 400);
    const variants = parseVariants([body.variant ?? '']);
    if (typeof variants === 'string') return json({ error: 'Name the variant' }, 400);
    const { data, error } = await db.rpc('inventory_add_variant', {
      p_product_id: body.productId,
      p_variant: variants[0],
      p_created_by: email,
    });
    if (error) {
      if (error.code === 'P0001') return json({ error: error.message }, 409);
      return dbError(error, DUPLICATE_VARIANT);
    }
    return json({ itemId: data as string }, 201);
  }

  const product = normalizeProduct(body);
  if (!product.ok) return json({ error: product.error }, 400);
  const variants = parseVariants(body.variants);
  if (typeof variants === 'string') return json({ error: variants }, 400);
  // The shared settings are validated exactly as on a standalone item.
  const item = normalizeItem({ ...body, name: product.value.name });
  if (!item.ok) return json({ error: item.error }, 400);
  const categoryError = await checkCategory(db, product.value.category_id);
  if (categoryError) return categoryError;
  const unitError = await checkUnits(db, item.value);
  if (unitError) return unitError;

  const rawSpots = body.spots ?? [];
  if (!Array.isArray(rawSpots) || rawSpots.length > MAX_SPOTS || !rawSpots.every(isUuid)) {
    return json({ error: `spots must be at most ${MAX_SPOTS} area ids` }, 400);
  }

  const shared: Record<string, unknown> = {};
  for (const column of SHARED_COLUMNS) {
    if (column in item.value) shared[column] = item.value[column];
  }

  const { data, error } = await db.rpc('inventory_create_product', {
    p_name: product.value.name,
    p_category_id: product.value.category_id ?? null,
    p_variants: variants,
    p_item: shared,
    p_area_ids: [...new Set(rawSpots as string[])],
    p_created_by: email,
  });
  if (error) {
    if (error.code === 'P0001') return json({ error: error.message }, 409);
    if (error.code === '23514') return json({ error: 'Check the re-order levels' }, 400);
    return dbError(error, DUPLICATE);
  }
  return json(data, 201);
};

export const PATCH: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, body } = ready;

  const id = url.searchParams.get('id');
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const normalized = normalizeProduct(body, { partial: true });
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  if (Object.keys(normalized.value).length === 0) return json({ error: 'Nothing to update' }, 400);
  if (typeof normalized.value.category_id === 'string') {
    // Keeping a since-retired category is fine; changing to one isn't.
    const { data: current } = await db
      .from('inventory_products')
      .select('category_id')
      .eq('id', id)
      .maybeSingle();
    if (
      (current as { category_id: string | null } | null)?.category_id !==
      normalized.value.category_id
    ) {
      const categoryError = await checkCategory(db, normalized.value.category_id);
      if (categoryError) return categoryError;
    }
  }

  const { data, error } = await db
    .from('inventory_products')
    .update(normalized.value)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    if (error.code === 'P0001') return json({ error: error.message }, 409);
    return dbError(error, DUPLICATE);
  }
  if (!data) return json({ error: 'Product not found' }, 404);
  return json({ product: data as InventoryProductRow });
};
