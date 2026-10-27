// One inventory item's history, for the History tab of its details dialog
// on /admin/inventory.
//
//   GET ?id=<uuid>   → InventoryHistoryResponse (newest first, capped)
//
// Gated on the /admin/inventory page grant: anyone who can count an item can
// see how it has changed. /api/admin/inventory writes the rows.

import type { APIRoute } from 'astro';
import { beginRead, dbError, isUuid, json } from '@/lib/http/route';
import {
  INVENTORY_HREF,
  type InventoryHistoryEntry,
  type InventoryHistoryResponse,
} from '@/lib/inventory/types';
import { getPeopleNames } from '@/lib/sops/people';

// About a year of daily counts.
const MAX_ENTRIES = 400;

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { db } = ready;

  const id = url.searchParams.get('id');
  if (!isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('inventory_history')
    .select('*')
    .eq('item_id', id)
    .order('changed_at', { ascending: false })
    .limit(MAX_ENTRIES + 1);
  if (error) return dbError(error);
  const rows = (data ?? []) as InventoryHistoryEntry[];
  const entries = rows
    .slice(0, MAX_ENTRIES)
    .map((row) => ({ ...row, in_stock: Number(row.in_stock) }));
  const people = await getPeopleNames(entries.map((e) => e.changed_by));
  const body: InventoryHistoryResponse = {
    entries,
    people,
    truncated: rows.length > MAX_ENTRIES,
  };
  return json(body);
};
