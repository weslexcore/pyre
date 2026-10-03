// Inventory items for /admin/inventory (admins only): POST adds one — with
// the spots it lives in and their opening counts, so setting up an item is
// one form — and PATCH edits lot size, re-order settings, cost, a variant's
// label or position, or retires it. Items are never deleted (the ledger
// references them); retiring is active=false. Products with variants are
// created through inventory-products.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { beginMutation, type Db, dbError, isUuid, json } from '@/lib/http/route';
import { parseQuantity } from '@/lib/inventory/rules';
import type { InventoryItemRow } from '@/lib/inventory/types';
import { normalizeItem } from '@/lib/inventory/validate';

const DUPLICATE = 'An active item already has that name';
const MAX_SPOTS = 20;

interface PlacementInput {
  areaId: string;
  /** Opening count in this spot; 0 or absent places it with nothing on hand. */
  quantity: number;
}

function parsePlacements(raw: unknown): PlacementInput[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SPOTS) {
    return `spots must be an array of at most ${MAX_SPOTS}`;
  }
  const seen = new Set<string>();
  const out: PlacementInput[] = [];
  for (const entry of raw as Record<string, unknown>[]) {
    if (!isUuid(entry?.areaId)) return 'each spot needs an areaId';
    if (seen.has(entry.areaId)) return 'each area can only be listed once';
    seen.add(entry.areaId);
    const quantity =
      entry.quantity == null || entry.quantity === 0 || entry.quantity === ''
        ? 0
        : parseQuantity(entry.quantity);
    if (quantity == null) return 'opening quantities must be numbers ≥ 0';
    out.push({ areaId: entry.areaId, quantity });
  }
  return out;
}

/**
 * A chosen category must exist and be active — a retired one stays on the
 * items that already have it, but isn't offered for new choices. Returns the
 * 400 to send, or null when fine (including no category).
 */
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

  const normalized = normalizeItem(body);
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  const categoryError = await checkCategory(db, normalized.value.category_id);
  if (categoryError) return categoryError;
  const placements = parsePlacements(body.spots);
  if (typeof placements === 'string') return json({ error: placements }, 400);

  if (placements.length > 0) {
    const { data: areas, error } = await db
      .from('inventory_areas')
      .select('id')
      .eq('active', true)
      .in(
        'id',
        placements.map((p) => p.areaId)
      );
    if (error) return dbError(error);
    if ((areas ?? []).length !== placements.length) {
      return json({ error: 'One of the storage areas no longer exists' }, 400);
    }
  }

  const { data, error } = await db
    .from('inventory_items')
    .insert({ ...normalized.value, created_by: email })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23514') return json({ error: 'Check the re-order levels' }, 400);
    return dbError(error, DUPLICATE);
  }
  const item = data as InventoryItemRow;

  if (placements.length > 0) {
    const { error: spotError } = await db
      .from('inventory_item_spots')
      .insert(
        placements.map((p, index) => ({ item_id: item.id, area_id: p.areaId, sort_order: index }))
      );
    if (spotError) return dbError(spotError);

    const opening = placements.filter((p) => p.quantity > 0);
    if (opening.length > 0) {
      const { error: ledgerError } = await db.from('inventory_movements').insert(
        opening.map((p) => ({
          item_id: item.id,
          area_id: p.areaId,
          movement_type: 'initial',
          quantity: p.quantity,
          unit_cost_cents: item.unit_cost_cents,
          recorded_by: email,
        }))
      );
      if (ledgerError) return dbError(ledgerError);
    }
  }

  return json({ item }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, body } = ready;

  const id = url.searchParams.get('id');
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const normalized = normalizeItem(body, { partial: true });
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  if (typeof normalized.value.category_id === 'string') {
    // Re-saving an item that already sits in a since-retired category is
    // fine; only a change of category has to pick an active one.
    const { data: current } = await db
      .from('inventory_items')
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
  if (Object.keys(normalized.value).length === 0) return json({ error: 'Nothing to update' }, 400);

  const { data, error } = await db
    .from('inventory_items')
    .update(normalized.value)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    // e.g. restoring a variant whose product is retired
    if (error.code === 'P0001') return json({ error: error.message }, 409);
    if (error.code === '23514' && 'variant' in normalized.value) {
      return json({ error: 'Only a variant of a product has a variant name' }, 400);
    }
    // The table keeps fill-to ≥ re-order level; a patch of one can break it.
    if (error.code === '23514') {
      return json({ error: 'The fill-to level must be at least the re-order level' }, 400);
    }
    return dbError(error, DUPLICATE);
  }
  if (!data) return json({ error: 'Item not found' }, 404);
  return json({ item: data as InventoryItemRow });
};
