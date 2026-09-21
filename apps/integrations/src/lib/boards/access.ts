// Who may open which board. Pure and client-safe, and the reason the founders
// can hand a community manager the rental pipeline without handing over the
// company's goals.
//
// Three ways in, in order of reach:
//
//   * admin                 — every board.
//   * '/admin/boards'       — every board (the page grant). '/admin/goals',
//                             the grant the old Goals page was issued under,
//                             means the same thing: the two pages are one
//                             tool now, and nobody loses access in the merge.
//   * 'board:<slug>'        — that board, and the /admin/boards index
//                             filtered down to it. Nothing else.
//
// A board's goal travels with the board: holding board:rentals shows the
// rental goal and its KPI meters, and lets the holder type in a measurement,
// because the person working the pipeline is the person who knows the number.
// Defining KPIs, editing the goal, and calling it met stay with the tool.

import type { PageAccess } from '@/components/admin/adminTools';
import { GOALS_HREF } from '@/lib/goals/types';
import { BOARDS_HREF, boardGrantKey, boardSlugFromGrant, isBoardGrantKey } from './types';

/**
 * Holding every board: admin, the page grant itself, or the legacy goals
 * grant it absorbed.
 *
 * Deliberately not adminTools.canViewPage, which answers a different
 * question. canViewPage(BOARDS_HREF) is true for a single-board grantee too,
 * because they do need the tool and its URLs — and routing this through it
 * would hand 'board:rentals' the whole board list, which is the one thing the
 * per-board grant exists to prevent.
 */
function holdsEveryBoard(access: PageAccess): boolean {
  return access.isAdmin || access.pages.includes(BOARDS_HREF) || access.pages.includes(GOALS_HREF);
}

/**
 * Whether this user may create a board, rename one, edit its columns, set
 * or edit its goal, define its KPIs, or delete it. A single-board grant is a
 * grant to work *in* a board, not to reshape the tool — the community
 * manager moves leads between columns; they do not add a column, and they
 * certainly do not add a board.
 */
export function canManageBoards(access: PageAccess): boolean {
  return holdsEveryBoard(access);
}

/** Whether this user may open the board at `slug`. */
export function canViewBoard(access: PageAccess, slug: string): boolean {
  if (holdsEveryBoard(access)) return true;
  return access.pages.includes(boardGrantKey(slug));
}

/**
 * Whether this user may work the goal on the board at `slug`: read its
 * trail, comment on it, and type in a KPI measurement. The same people who
 * can open the board — the number belongs to whoever is doing the work.
 */
export function canWorkGoal(access: PageAccess, slug: string): boolean {
  return canViewBoard(access, slug);
}

/** Whether this user holds at least one single-board grant. */
export function hasAnyBoardGrant(access: PageAccess): boolean {
  return access.pages.some(isBoardGrantKey);
}

/**
 * Whether the Boards tool should appear at all: the page grant, or any
 * single-board grant. adminTools.canViewPage defers to this rule so the nav,
 * the dashboard cards, and the search agree with the pages themselves.
 */
export function canViewBoardsTool(access: PageAccess): boolean {
  return holdsEveryBoard(access) || hasAnyBoardGrant(access);
}

/** The slugs named by this user's single-board grants. */
export function grantedBoardSlugs(access: PageAccess): string[] {
  return access.pages.filter(isBoardGrantKey).map(boardSlugFromGrant);
}

/** The boards this user's index page should list, in the order given. */
export function visibleBoards<T extends { slug: string }>(access: PageAccess, boards: T[]): T[] {
  if (holdsEveryBoard(access)) return boards;
  const granted = new Set(grantedBoardSlugs(access));
  return boards.filter((board) => granted.has(board.slug));
}
