// Display ordering for the SOP library: categories rank by their
// sop_categories position (unranked categories sort after all ranked ones,
// alphabetically), documents within a category by sort_order then title.
// Client-bundle-safe pure functions, shared by the list API and the island.

export interface CategoryRank {
  name: string;
  sort_order: number;
}

interface Sortable {
  category: string;
  sort_order: number;
  title: string;
}

export function sortSops<T extends Sortable>(sops: T[], ranks: CategoryRank[]): T[] {
  const rank = new Map(ranks.map((r) => [r.name, r.sort_order]));
  return [...sops].sort((a, b) => {
    const ra = rank.get(a.category) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.category) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.title.localeCompare(b.title);
  });
}

/** Category names in display order, derived from an already-sorted sops list. */
export function categoriesInOrder(sops: Sortable[]): string[] {
  return [...new Set(sops.map((s) => s.category))];
}

// ---------------------------------------------------------------------------
// Live-reorder helpers for the drag-and-drop UI. Each returns a new array (or
// the input untouched when the move is a no-op) — the island renders these
// optimistically while dragging and persists the final arrangement on drop.
// ---------------------------------------------------------------------------

interface Draggable {
  id: string;
  category: string;
}

/**
 * Move the dragged document to the position of `targetId`, adopting the
 * target's category (so dragging onto a card in another section moves the
 * document there). Dragging downward lands after the target, upward before it
 * — the standard sortable-list feel.
 */
export function repositionSop<T extends Draggable>(
  sops: T[],
  dragId: string,
  targetId: string
): T[] {
  if (dragId === targetId) return sops;
  const from = sops.findIndex((s) => s.id === dragId);
  const to = sops.findIndex((s) => s.id === targetId);
  if (from < 0 || to < 0) return sops;

  const next = [...sops];
  const [moved] = next.splice(from, 1);
  const insertAt = next.findIndex((s) => s.id === targetId);
  next.splice(from < to ? insertAt + 1 : insertAt, 0, { ...moved, category: sops[to].category });
  return next;
}

/** Move the dragged document to the end of `category` (possibly empty). */
export function moveSopToCategoryEnd<T extends Draggable>(
  sops: T[],
  dragId: string,
  category: string
): T[] {
  const from = sops.findIndex((s) => s.id === dragId);
  if (from < 0) return sops;

  const next = [...sops];
  const [moved] = next.splice(from, 1);
  // After the last document of the target category; end of the list when the
  // category has none (its section renders wherever the category ranks).
  const lastInCategory = next.map((s) => s.category).lastIndexOf(category);
  const insertAt = lastInCategory >= 0 ? lastInCategory + 1 : next.length;
  if (insertAt === from && moved.category === category) return sops;
  next.splice(insertAt, 0, { ...moved, category });
  return next;
}

/** Move the dragged category name to the position of `targetName`. */
export function repositionCategory(
  categories: string[],
  dragName: string,
  targetName: string
): string[] {
  if (dragName === targetName) return categories;
  const from = categories.indexOf(dragName);
  const to = categories.indexOf(targetName);
  if (from < 0 || to < 0) return categories;

  const next = [...categories];
  next.splice(from, 1);
  const insertAt = next.indexOf(targetName);
  next.splice(from < to ? insertAt + 1 : insertAt, 0, dragName);
  return next;
}
