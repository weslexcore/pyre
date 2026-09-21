// Sections on the boards index: the headings boards sit under, in order,
// and the small moves a drag makes to them. Pure and client-safe — the
// island renders these while dragging and persists the arrangement on drop
// (api/admin/board-order.ts), the same shape as the SOP library's sections.
//
// A board with no section sits under an unnamed group after every named
// one. It has no row, so it cannot be renamed or dragged as a heading; it
// is where a board lands when its section is deleted, and it disappears
// from the page the moment it is empty.

import type { BoardRow, BoardSectionRow } from '@/lib/db';

type Section = Pick<BoardSectionRow, 'id' | 'name' | 'sort_order'>;
type Board = Pick<BoardRow, 'id' | 'name' | 'section_id' | 'sort_order'>;

/** Sections by position, then name. */
export function sectionsInOrder<S extends Section>(sections: S[]): S[] {
  return [...sections].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** Boards in display order: by section position, then hand order, then name. */
export function boardsInOrder<B extends Board>(boards: B[], sections: Section[]): B[] {
  const rank = new Map(sectionsInOrder(sections).map((section, index) => [section.id, index]));
  const rankOf = (board: Board) =>
    board.section_id === null
      ? Number.MAX_SAFE_INTEGER
      : (rank.get(board.section_id) ?? Number.MAX_SAFE_INTEGER - 1);
  return [...boards].sort(
    (a, b) => rankOf(a) - rankOf(b) || a.sort_order - b.sort_order || a.name.localeCompare(b.name)
  );
}

export interface SectionGroup<S, B> {
  /** Null for the unnamed group at the end. */
  section: S | null;
  boards: B[];
}

/**
 * Every section in order, with its boards — empty sections included, since
 * a section an admin just made is a real, empty shelf — and the unnamed
 * group last, only when something is in it. `boards` is taken as already in
 * display order (boardsInOrder, or the live order while dragging).
 */
export function groupBySection<S extends Section, B extends Board>(
  sections: S[],
  boards: B[]
): SectionGroup<S, B>[] {
  const groups: SectionGroup<S, B>[] = sectionsInOrder(sections).map((section) => ({
    section,
    boards: boards.filter((board) => board.section_id === section.id),
  }));
  const known = new Set(sections.map((section) => section.id));
  const loose = boards.filter((board) => board.section_id === null || !known.has(board.section_id));
  if (loose.length > 0) groups.push({ section: null, boards: loose });
  return groups;
}

/**
 * Move the dragged board to the position of `targetId`, adopting the
 * target's section (so dragging onto a card in another section moves the
 * board there). Dragging downward lands after the target, upward before it.
 */
export function repositionBoard<B extends Board>(
  boards: B[],
  dragId: string,
  targetId: string
): B[] {
  if (dragId === targetId) return boards;
  const from = boards.findIndex((board) => board.id === dragId);
  const to = boards.findIndex((board) => board.id === targetId);
  if (from < 0 || to < 0) return boards;

  const next = [...boards];
  const [moved] = next.splice(from, 1);
  const insertAt = next.findIndex((board) => board.id === targetId);
  next.splice(from < to ? insertAt + 1 : insertAt, 0, {
    ...moved,
    section_id: boards[to].section_id,
  });
  return next;
}

/** Move the dragged board to the end of `sectionId` (possibly empty). */
export function moveBoardToSectionEnd<B extends Board>(
  boards: B[],
  dragId: string,
  sectionId: string | null
): B[] {
  const from = boards.findIndex((board) => board.id === dragId);
  if (from < 0) return boards;

  const next = [...boards];
  const [moved] = next.splice(from, 1);
  const lastInSection = next.map((board) => board.section_id).lastIndexOf(sectionId);
  const insertAt = lastInSection >= 0 ? lastInSection + 1 : next.length;
  if (insertAt === from && moved.section_id === sectionId) return boards;
  next.splice(insertAt, 0, { ...moved, section_id: sectionId });
  return next;
}

/** Move the dragged section to the position of `targetId`. */
export function repositionSection<S extends Section>(
  sections: S[],
  dragId: string,
  targetId: string
): S[] {
  if (dragId === targetId) return sections;
  const ordered = sectionsInOrder(sections);
  const from = ordered.findIndex((section) => section.id === dragId);
  const to = ordered.findIndex((section) => section.id === targetId);
  if (from < 0 || to < 0) return sections;

  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  const insertAt = next.findIndex((section) => section.id === targetId);
  next.splice(from < to ? insertAt + 1 : insertAt, 0, moved);
  return next.map((section, index) => ({ ...section, sort_order: index }));
}
