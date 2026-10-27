// Inventory history: every change to an item, who made it, and the stock
// after (public.inventory_history). /api/admin/inventory writes a row on each
// add and edit; the same rows give an item's change log and the stock series
// its usage rate comes from. Server-only; the diffing (changes.ts) is pure
// and tested.

import type { SupabaseClient } from '@supabase/supabase-js';
import { diffItems, mergeChanges } from './changes';
import { USAGE_WINDOW_DAYS, usageOf } from './rules';
import type { InventoryHistoryEntry, InventoryRow } from './types';

/** Saves by one person this close together merge into one history row. */
export const MERGE_WINDOW_MS = 10 * 60_000;

/**
 * Records a change to an item. Best-effort, like the low-stock alert: a
 * failure is logged and never fails the save it describes.
 */
export async function recordChange(
  db: SupabaseClient,
  {
    action,
    before,
    after,
    email,
    now = new Date(),
  }: {
    action: 'add' | 'edit';
    before: InventoryRow | null;
    after: InventoryRow;
    email: string;
    now?: Date;
  }
): Promise<void> {
  try {
    const changes = diffItems(before, after);
    if (action === 'edit') {
      const { data: last } = await db
        .from('inventory_history')
        .select('id, action, changes, changed_by, changed_at')
        .eq('item_id', after.id)
        .order('changed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const prev = last as Pick<
        InventoryHistoryEntry,
        'id' | 'action' | 'changes' | 'changed_by' | 'changed_at'
      > | null;
      if (
        prev &&
        prev.action === 'edit' &&
        prev.changed_by === email &&
        now.getTime() - Date.parse(prev.changed_at) < MERGE_WINDOW_MS
      ) {
        const { error } = await db
          .from('inventory_history')
          .update({
            changes: mergeChanges(prev.changes, changes),
            in_stock: after.in_stock,
            changed_at: now.toISOString(),
          })
          .eq('id', prev.id);
        if (error) throw error;
        return;
      }
    }
    const { error } = await db.from('inventory_history').insert({
      item_id: after.id,
      action,
      changes,
      in_stock: after.in_stock,
      changed_by: email,
      changed_at: now.toISOString(),
    });
    if (error) throw error;
  } catch (e) {
    console.error('inventory history: could not record a change', e);
  }
}

const PAGE = 1000;

/**
 * Each item's usage per day over the last USAGE_WINDOW_DAYS, keyed by id
 * (items without enough history are left out). `itemId` limits it to one.
 */
export async function usageByItem(
  db: SupabaseClient,
  now: Date,
  itemId?: string
): Promise<Map<string, number>> {
  const since = new Date(now.getTime() - USAGE_WINDOW_DAYS * 86_400_000).toISOString();
  const points = new Map<string, { in_stock: number; at: string }[]>();
  for (let from = 0; ; from += PAGE) {
    let q = db
      .from('inventory_history')
      .select('item_id, in_stock, changed_at')
      .gte('changed_at', since)
      .order('changed_at')
      .order('id')
      .range(from, from + PAGE - 1);
    if (itemId) q = q.eq('item_id', itemId);
    const { data, error } = await q;
    if (error) {
      console.error('inventory history: could not read usage', error);
      break;
    }
    const rows = (data ?? []) as { item_id: string; in_stock: number; changed_at: string }[];
    for (const r of rows) {
      const list = points.get(r.item_id) ?? [];
      list.push({ in_stock: Number(r.in_stock), at: r.changed_at });
      points.set(r.item_id, list);
    }
    if (rows.length < PAGE) break;
  }
  const out = new Map<string, number>();
  for (const [id, list] of points) {
    const usage = usageOf(list, now);
    if (usage) out.set(id, usage.perDay);
  }
  return out;
}
