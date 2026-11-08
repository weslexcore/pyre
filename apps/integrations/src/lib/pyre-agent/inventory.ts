// What Pyre Agent reads of the inventory, on behalf of the person in the
// conversation: the list as /admin/inventory shows it — what is in stock,
// what is low, what is due for a count, how fast each item goes and when it
// runs out, who last counted it and where they said so. pyre-agents asks for
// it through /api/agent/pyre, which has already checked the asker holds the
// inventory page (everyone with the page reads the whole list; what they may
// change is a separate question, answered in ./actions). Shapes are compact
// and flat — the model reads them, not a page — with dashboard links it can
// cite. Server-only.

import { todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasInventoryManage, type PageAccess } from '@/components/admin/adminTools';
import { usageByItem } from '@/lib/inventory/history';
import {
  countEveryLabel,
  daysLeft,
  distinctValues,
  formatCents,
  formatDaysLeft,
  formatPerWeek,
  type InventoryFilter,
  isDue,
  isLow,
  listItems,
} from '@/lib/inventory/rules';
import { INVENTORY_HREF, type InventoryRow, inventoryItemHref } from '@/lib/inventory/types';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { getPeopleNames } from '@/lib/sops/people';
import { suggestionOrigins } from '@/lib/suggestions/origins';
import type { SuggestionResultLink } from '@/lib/suggestions/types';

/** Items one read returns at most. */
const MAX_ITEMS = 120;
/** Ordering instructions are cut to this in the list. */
const HOW_TO_ORDER_PREVIEW = 200;

export interface FindInventoryInput {
  /** Words to match against name, category, location, vendor, or how to order. */
  query?: string;
  /** low = at or below its re-order level; due = due for a count; inactive = set aside. */
  filter?: InventoryFilter;
  category?: string;
  limit?: number;
}

/** PostgREST hands numeric columns back as strings. */
function numericRow(row: InventoryRow): InventoryRow {
  return {
    ...row,
    in_stock: Number(row.in_stock),
    reorder_at: row.reorder_at == null ? null : Number(row.reorder_at),
  };
}

/** Every item, numeric, with its usage rate — the same rows the list shows. */
export async function loadInventoryForAgent(db: SupabaseClient): Promise<InventoryRow[]> {
  const { data, error } = await db.from('inventory').select('*').order('name');
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as InventoryRow[]).map(numericRow);
  const usage = await usageByItem(db, new Date());
  return rows.map((row) => ({ ...row, usage_per_day: usage.get(row.id) ?? null }));
}

export function itemView(
  item: InventoryRow,
  now: Date,
  people: PeopleNames,
  origin: SuggestionResultLink | undefined
) {
  const left = daysLeft(item);
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    location: item.location,
    inStock: item.in_stock,
    reorderAt: item.reorder_at,
    low: isLow(item),
    dueForCount: isDue(item, now),
    countEvery: item.count_every_days ? countEveryLabel(item.count_every_days) : null,
    countInstructions: item.count_instructions,
    lastCounted: item.last_counted_at
      ? {
          at: item.last_counted_at,
          by: item.last_counted_by ? personName(item.last_counted_by, people) : null,
          // A count read out of a shift note by the suggestion agent says so.
          ...(origin ? { from: origin.label, fromUrl: origin.href } : {}),
        }
      : null,
    usePerWeek: item.usage_per_day == null ? null : formatPerWeek(item.usage_per_day),
    runsOutIn: left == null ? null : formatDaysLeft(left),
    unitCost: item.unit_cost_cents == null ? null : formatCents(item.unit_cost_cents),
    vendor: item.vendor,
    howToOrder:
      item.how_to_order && item.how_to_order.length > HOW_TO_ORDER_PREVIEW
        ? `${item.how_to_order.slice(0, HOW_TO_ORDER_PREVIEW)}…`
        : item.how_to_order,
    active: item.active,
    url: inventoryItemHref(item.id),
  };
}

/**
 * The inventory list, filtered and in the list's own order (name, with the
 * low and due items flagged). The whole list is small; the limit keeps a
 * broad question from flooding the model.
 */
export async function inventoryForAgent(
  db: SupabaseClient,
  access: PageAccess,
  input: FindInventoryInput
) {
  const now = new Date();
  const items = await loadInventoryForAgent(db);
  const filter: InventoryFilter =
    input.filter === 'reorder' || input.filter === 'due' || input.filter === 'inactive'
      ? input.filter
      : 'all';
  const rows = listItems(
    items,
    {
      search: input.query ?? '',
      filter,
      category: input.category ?? '',
      sort: 'name',
      desc: false,
    },
    now
  );
  const shown = rows.slice(0, Math.min(Math.max(input.limit ?? MAX_ITEMS, 1), MAX_ITEMS));

  const [people, origins] = await Promise.all([
    getPeopleNames(shown.map((i) => i.last_counted_by).filter((e): e is string => !!e)),
    suggestionOrigins(
      db,
      shown.map((i) => i.last_count_suggestion_id).filter((id): id is string => !!id)
    ),
  ]);

  const active = items.filter((i) => i.active);
  return {
    today: todayEastern(),
    url: INVENTORY_HREF,
    canManage: hasInventoryManage(access),
    categories: distinctValues(active, 'category'),
    totals: {
      active: active.length,
      low: active.filter(isLow).length,
      dueForCount: active.filter((i) => isDue(i, now)).length,
      inactive: items.length - active.length,
    },
    count: rows.length,
    items: shown.map((item) =>
      itemView(
        item,
        now,
        people,
        item.last_count_suggestion_id ? origins[item.last_count_suggestion_id] : undefined
      )
    ),
    ...(rows.length > shown.length
      ? { note: `${rows.length - shown.length} more items match; narrow the query or filter.` }
      : {}),
  };
}
