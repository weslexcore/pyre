// inventory.create: a supply the inventory does not track yet, when a note
// mentions one ("we keep a box of earplugs at the desk now, about 40 left").
// Applied the way an add on /admin/inventory is — the row, a history row —
// with the approving admin as the item's creator. A starting number the
// note gave is credited, like an approved inventory.count, to the note's
// author at the time of the note, with the suggestion stamped on the item
// (created_suggestion_id, and last_count_suggestion_id when it was counted)
// and on its history row, so the list and the change log link the note.

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordChange } from '@/lib/inventory/history';
import { formatQuantity } from '@/lib/inventory/rules';
import { type InventoryRow, inventoryItemHref } from '@/lib/inventory/types';
import { type InventoryCreatePayload, PAYLOAD_PARSERS } from '../types';
import type { Applied, KindHandler } from './handler';

/** The list's own rule (inventory_name_idx): names are unique ignoring case and outer spaces. */
export function sameItemName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** PostgREST hands numeric columns back as strings. */
function numeric(row: InventoryRow): InventoryRow {
  return {
    ...row,
    in_stock: Number(row.in_stock),
    reorder_at: row.reorder_at == null ? null : Number(row.reorder_at),
  };
}

/** An item already on the list under this name (any case), active or not. */
async function findByName(
  db: SupabaseClient,
  name: string
): Promise<Pick<InventoryRow, 'id' | 'name' | 'active'> | null> {
  const { data, error } = await db.from('inventory').select('id, name, active');
  if (error) throw new Error(error.message);
  return (
    ((data ?? []) as Pick<InventoryRow, 'id' | 'name' | 'active'>[]).find((item) =>
      sameItemName(item.name, name)
    ) ?? null
  );
}

function appliedFor(item: Pick<InventoryRow, 'id' | 'name' | 'in_stock'>): Applied {
  return {
    resultType: 'inventory_item',
    resultId: item.id,
    label: `${item.name}: added, ${formatQuantity(Number(item.in_stock))} in stock`,
    href: inventoryItemHref(item.id),
  };
}

export const inventoryCreate: KindHandler<'inventory.create'> = {
  parse: PAYLOAD_PARSERS['inventory.create'],

  async validate(db, payload) {
    const existing = await findByName(db, payload.name);
    if (existing) {
      return {
        ok: false,
        status: 409,
        error: `${existing.name} is already on the inventory${
          existing.active ? '' : ' (set aside)'
        }; suggest a count on it (itemId ${existing.id}) instead of a new item`,
        detail: { itemId: existing.id },
      };
    }
    const value: InventoryCreatePayload = { ...payload };
    return { ok: true, payload: value, target: null };
  },

  async apply(db, payload, context) {
    // A retry after a crash finds the item the first attempt added.
    const { data: made } = await db
      .from('inventory')
      .select('*')
      .eq('created_suggestion_id', context.suggestion.id)
      .maybeSingle();
    if (made) return appliedFor(numeric(made as InventoryRow));

    const counted = payload.inStock !== null;
    // The count is the note author's, at the note's time; a note that can't
    // be read (deleted since) falls back to the approving admin, now.
    const countedBy = payload.countedBy ?? context.origin?.author ?? context.actor;
    const countedAtRaw = payload.countedAt ?? context.origin?.recordedAt ?? null;
    const countedAt =
      countedAtRaw && !Number.isNaN(Date.parse(countedAtRaw)) ? new Date(countedAtRaw) : new Date();

    const { data, error } = await db
      .from('inventory')
      .insert({
        name: payload.name,
        category: payload.category,
        location: payload.location,
        vendor: payload.vendor,
        in_stock: payload.inStock ?? 0,
        reorder_at: payload.reorderAt,
        count_every_days: payload.countEveryDays,
        active: true,
        created_by: context.actor,
        created_suggestion_id: context.suggestion.id,
        ...(counted
          ? {
              last_counted_at: countedAt.toISOString(),
              last_counted_by: countedBy,
              last_count_suggestion_id: context.suggestion.id,
            }
          : {}),
      })
      .select('*')
      .single();
    if (error) {
      // The unique name index: someone added it while this waited.
      if (error.code === '23505') {
        throw new Error(`An item named ${payload.name} was added since; count it instead`);
      }
      throw new Error(error.message);
    }
    const item = numeric(data as InventoryRow);

    await recordChange(db, {
      action: 'add',
      before: null,
      after: item,
      email: counted ? countedBy : context.actor,
      now: counted ? countedAt : new Date(),
      suggestionId: context.suggestion.id,
    });
    return appliedFor(item);
  },
};
