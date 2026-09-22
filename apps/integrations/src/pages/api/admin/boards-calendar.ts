// The cross-board calendar (/admin/boards/calendar): the read behind the
// month that spans every board.
//
// Like All Tasks, it hands over rows rather than a view — the island runs
// buildCalendar, so the board chips and the finished toggle change what is
// drawn without a round trip. The one thing the server decides is the
// window, because a calendar with no window is every dated thing the company
// has ever written down.
//
// The page spans every board, so it is the whole tool's: a single-board grant
// does not reach it, the same rule All Tasks and All goals follow.
//
//   GET ?start=YYYY-MM-DD&end=YYYY-MM-DD
//     → { boards, columns, fields, cards, goals, people, today }

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards } from '@/lib/boards/access';
import { monthGridRange, monthStartOf } from '@/lib/boards/calendar';
import { type APIRoute, beginRead, json, storeError } from '@/lib/boards/route';
import { loadBoards, loadBoardsCalendar } from '@/lib/boards/store';
import { isYmd } from '@/lib/goals/validate';
import { todayEastern } from '@/lib/shift-notes/validate';

/**
 * A month grid is 42 days; this leaves room for a quarter without letting a
 * hand-typed URL ask for a decade.
 */
const MAX_WINDOW_DAYS = 120;

function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
  );
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  if (!canManageBoards(ready.gate.access)) return json({ error: 'Forbidden' }, 403);

  const thisMonth = monthGridRange(monthStartOf(todayEastern()));
  const start = url.searchParams.get('start') ?? thisMonth.gridStart;
  const end = url.searchParams.get('end') ?? thisMonth.gridEnd;
  if (!isYmd(start) || !isYmd(end)) {
    return json({ error: 'start and end must be YYYY-MM-DD dates' }, 400);
  }
  if (end < start) return json({ error: 'end comes before start' }, 400);
  if (daysBetween(start, end) > MAX_WINDOW_DAYS) {
    return json({ error: `A calendar window is ${MAX_WINDOW_DAYS} days at most` }, 400);
  }

  try {
    // Archived boards are dropped in the store; the whole list goes in so a
    // later grant model can filter it without changing the read.
    return json(await loadBoardsCalendar(ready.db, await loadBoards(ready.db), start, end));
  } catch (e) {
    return storeError('boards-calendar', e);
  }
};
