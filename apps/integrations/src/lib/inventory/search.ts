// The inventory half of the global search (cmd+K): which items match a
// term, by name first and then by vendor or category. Pure, so the ranking is
// unit-tested; the /api/admin/search route supplies the rows and decides who
// may see them.

import type { InventoryHit } from '@/lib/admin/globalSearch';
import { matchesTerm } from '@/lib/sops/search';
import { isDue, isLow } from './rules';
import type { InventoryRow } from './types';

/**
 * Items matching `term`, best first: a name that starts with it, a name
 * containing it, then a vendor match. Ties keep alphabetical order.
 */
export function searchInventory(
  items: readonly InventoryRow[],
  term: string,
  { max, now }: { max: number; now: Date }
): InventoryHit[] {
  const q = term.trim();
  if (!q) return [];
  const lower = q.toLowerCase();

  const ranked: { item: InventoryRow; rank: number }[] = [];
  for (const item of items) {
    let rank: number;
    if (item.name.toLowerCase().startsWith(lower)) rank = 0;
    else if (matchesTerm(item.name, q)) rank = 1;
    else if (
      (item.vendor && matchesTerm(item.vendor, q)) ||
      (item.category && matchesTerm(item.category, q))
    )
      rank = 2;
    else continue;
    ranked.push({ item, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name));

  return ranked.slice(0, max).map(({ item }) => ({
    id: item.id,
    name: item.name,
    vendor: item.vendor ?? '',
    category: item.category ?? '',
    inStock: item.in_stock,
    low: isLow(item),
    due: isDue(item, now),
  }));
}
