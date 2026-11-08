// inventory.count: a new stock number for one inventory item, when a note
// says how much of something is left ("three rolls of trash bags left",
// "we're out of eucalyptus"). Applied the way a count on /admin/inventory
// is — the item's in_stock, a history row, the low-stock alert — except that
// the count is credited to the note's author at the time of the note, with
// the suggestion (and through it the note) stamped on the item and the
// history row, so the list can say who counted it and link where they said
// so. The approving admin is the suggestion's decider, not the counter.

import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyIfLow } from '@/lib/inventory/alerts';
import { recordChange } from '@/lib/inventory/history';
import { formatQuantity } from '@/lib/inventory/rules';
import { type InventoryRow, inventoryItemHref } from '@/lib/inventory/types';
import { type InventoryCountPayload, PAYLOAD_PARSERS } from '../types';
import type { Applied, KindHandler } from './handler';

/** PostgREST hands numeric columns back as strings. */
function numeric(row: InventoryRow): InventoryRow {
  return {
    ...row,
    in_stock: Number(row.in_stock),
    reorder_at: row.reorder_at == null ? null : Number(row.reorder_at),
  };
}

async function loadItem(db: SupabaseClient, id: string): Promise<InventoryRow | null> {
  const { data } = await db.from('inventory').select('*').eq('id', id).maybeSingle();
  const row = data as InventoryRow | null;
  return row ? numeric(row) : null;
}

function appliedFor(item: Pick<InventoryRow, 'id' | 'name'>, inStock: number): Applied {
  return {
    resultType: 'inventory_item',
    resultId: item.id,
    label: `${item.name}: ${formatQuantity(inStock)} in stock`,
    href: inventoryItemHref(item.id),
  };
}

export const inventoryCount: KindHandler<'inventory.count'> = {
  parse: PAYLOAD_PARSERS['inventory.count'],

  async validate(db, payload) {
    const item = await loadItem(db, payload.itemId);
    if (!item) return { ok: false, status: 404, error: `No inventory item ${payload.itemId}` };
    if (!item.active) {
      return {
        ok: false,
        status: 422,
        error: `${item.name} is set aside (inactive); mark it active on /admin/inventory before counting it`,
      };
    }
    // The item as it stands, for the admin reading the suggestion. Who
    // counted it (the note's author) is filled at intake and kept as sent.
    const value: InventoryCountPayload = {
      ...payload,
      itemName: item.name,
      previousInStock: item.in_stock,
      reorderAt: item.reorder_at,
      lastCountedAt: item.last_counted_at,
      lastCountedBy: item.last_counted_by,
    };
    return { ok: true, payload: value, target: { type: 'inventory_item', id: item.id } };
  },

  async apply(db, payload, context) {
    const before = await loadItem(db, payload.itemId);
    if (!before) throw new Error('That inventory item no longer exists');

    // A retry after a crash finds the count the first attempt recorded.
    const { data: existing } = await db
      .from('inventory_history')
      .select('id')
      .eq('suggestion_id', context.suggestion.id)
      .maybeSingle();
    if (existing) return appliedFor(before, payload.inStock);

    // The count is the note author's, at the note's time; a note the author
    // can't be read from (deleted since) falls back to the approving admin,
    // now.
    const countedBy = payload.countedBy ?? context.origin?.author ?? context.actor;
    const countedAtRaw = payload.countedAt ?? context.origin?.recordedAt ?? null;
    const countedAt =
      countedAtRaw && !Number.isNaN(Date.parse(countedAtRaw)) ? new Date(countedAtRaw) : new Date();

    const { data, error } = await db
      .from('inventory')
      .update({
        in_stock: payload.inStock,
        last_counted_at: countedAt.toISOString(),
        last_counted_by: countedBy,
        last_count_suggestion_id: context.suggestion.id,
      })
      .eq('id', before.id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('That inventory item no longer exists');
    const after = numeric(data as InventoryRow);

    await recordChange(db, {
      action: 'edit',
      before,
      after,
      email: countedBy,
      now: countedAt,
      suggestionId: context.suggestion.id,
    });
    await notifyIfLow(db, after, before.in_stock, after.in_stock, context.actor);
    return appliedFor(after, after.in_stock);
  },
};
