// Server-side check for the units an item form picked (inventory-items and
// inventory-products). Server-only (takes the db, returns ready 400s).

import { type Db, dbError, json } from '@/lib/http/route';

/**
 * Picked units must exist and be active — a retired one stays on the items
 * that already have it, but isn't offered for new choices. `keep` lists the
 * unit ids the item already has, which may be re-saved even if retired.
 * Returns the response to send, or null when fine.
 */
export async function checkUnits(
  db: Db,
  columns: Record<string, unknown>,
  keep: readonly (string | null)[] = []
): Promise<Response | null> {
  const ids = [columns.unit_id, columns.lot_unit_id].filter(
    (id): id is string => typeof id === 'string' && !keep.includes(id)
  );
  if (ids.length === 0) return null;
  const { data, error } = await db
    .from('inventory_units')
    .select('id')
    .eq('active', true)
    .in('id', ids);
  if (error) return dbError(error);
  if (new Set((data ?? []).map((u: { id: string }) => u.id)).size !== new Set(ids).size) {
    return json({ error: 'That unit no longer exists' }, 400);
  }
  return null;
}
