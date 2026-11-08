// Which inventory items a note might be talking about, so "three rolls of
// trash bags left" can become an inventory.count on the right item. A term
// match over name, category, location and vendor, best matches first, with
// each item's stock on record and last count — the list is small enough to
// rank in memory. Active items only: a set-aside item cannot be counted
// until someone brings it back. Read-only.

import { getDb } from '../db';
import { siteUrl } from '../knowledge/urls';
import { scoreTerms, searchTerms } from './cards';

interface ItemRow {
  id: string;
  name: string;
  category: string | null;
  location: string | null;
  vendor: string | null;
  in_stock: number | string;
  reorder_at: number | string | null;
  count_every_days: number | null;
  last_counted_at: string | null;
  last_counted_by: string | null;
}

/** Name matches count double: an item's name is what it is. */
export function scoreItem(
  item: Pick<ItemRow, 'name' | 'category' | 'location' | 'vendor'>,
  terms: string[]
): number {
  return scoreTerms(
    item.name,
    [item.category, item.location, item.vendor].filter(Boolean).join(' '),
    terms
  );
}

export async function findInventoryItems(input: { query: string; limit?: number }) {
  const terms = searchTerms(input.query);
  if (terms.length === 0) return { items: [], note: 'Search with a few key words (3+ letters).' };

  const db = getDb();
  const { data, error } = await db
    .from('inventory')
    .select(
      'id, name, category, location, vendor, in_stock, reorder_at, count_every_days, last_counted_at, last_counted_by'
    )
    .eq('active', true)
    .order('name');
  if (error) throw new Error(error.message);

  const ranked = ((data ?? []) as ItemRow[])
    .map((item) => ({ item, score: scoreItem(item, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, input.limit ?? 8);

  const counters = [
    ...new Set(ranked.map(({ item }) => item.last_counted_by).filter((e): e is string => !!e)),
  ];
  const { data: staff } = counters.length
    ? await db.from('staff').select('email, display_name').in('email', counters)
    : { data: [] };
  const names = new Map(
    ((staff ?? []) as { email: string | null; display_name: string | null }[])
      .filter((s) => s.email)
      .map((s) => [String(s.email).toLowerCase(), s.display_name ?? ''])
  );

  return {
    items: ranked.map(({ item }) => ({
      itemId: item.id,
      name: item.name,
      category: item.category,
      location: item.location,
      inStock: Number(item.in_stock),
      reorderAt: item.reorder_at == null ? null : Number(item.reorder_at),
      countEveryDays: item.count_every_days,
      lastCountedAt: item.last_counted_at,
      lastCountedBy: item.last_counted_by
        ? names.get(item.last_counted_by.toLowerCase()) || item.last_counted_by
        : null,
      url: siteUrl(`/admin/inventory?item=${item.id}`),
    })),
    ...(ranked.length === 0
      ? { note: 'No active inventory item matches; the note may be about something not on the list. Do not invent an item.' }
      : {}),
  };
}
