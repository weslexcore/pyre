// The inventory half of the global search (cmd+K): which active items match a
// term, by name first and then by category, vendor, or unit. Pure, so the
// ranking is unit-tested; the /api/admin/search route supplies the rows and
// decides who may see them.

import type { InventoryHit } from '@/lib/admin/globalSearch';
import { matchesTerm } from '@/lib/sops/search';
import { isLowStock, totalsByItem } from './rules';
import type {
  InventoryAreaRow,
  InventoryCategoryRow,
  InventoryItemRow,
  InventorySpotRow,
  InventoryStockRow,
} from './types';

export interface InventorySearchData {
  items: readonly InventoryItemRow[];
  categories: readonly InventoryCategoryRow[];
  areas: readonly InventoryAreaRow[];
  spots: readonly InventorySpotRow[];
  stock: readonly InventoryStockRow[];
}

/**
 * Active items matching `term`, best first: a name that starts with it, a
 * name containing it, then a category, vendor, or unit match. Ties keep
 * alphabetical order. `editable` is stamped on every hit so the palette can
 * link admins to the edit form and everyone else to the stock page.
 */
export function searchInventory(
  data: InventorySearchData,
  term: string,
  { max, editable }: { max: number; editable: boolean }
): InventoryHit[] {
  const q = term.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));
  const areaById = new Map(data.areas.map((a) => [a.id, a]));
  const totals = totalsByItem(data.stock);

  const ranked: { item: InventoryItemRow; rank: number; category: string }[] = [];
  for (const item of data.items) {
    if (!item.active) continue;
    const category = item.category_id ? (categoryName.get(item.category_id) ?? '') : '';
    let rank: number;
    if (item.name.toLowerCase().startsWith(lower)) rank = 0;
    else if (matchesTerm(item.name, q)) rank = 1;
    else if (
      (category && matchesTerm(category, q)) ||
      (item.vendor && matchesTerm(item.vendor, q)) ||
      matchesTerm(item.unit, q)
    )
      rank = 2;
    else continue;
    ranked.push({ item, rank, category });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name));

  return ranked.slice(0, max).map(({ item, category }) => {
    const onHand = totals.get(item.id) ?? 0;
    const areas = data.spots
      .filter((s) => s.item_id === item.id)
      .map((s) => areaById.get(s.area_id))
      .filter((a): a is InventoryAreaRow => !!a?.active)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((a) => a.name);
    return {
      id: item.id,
      name: item.name,
      category,
      unit: item.unit,
      onHand,
      low: isLowStock(item, onHand),
      areas,
      editable,
    };
  });
}
