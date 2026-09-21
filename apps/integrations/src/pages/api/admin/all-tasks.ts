// All Tasks (/admin/boards/tasks): the read behind the cross-board page.
//
// It hands over rows, not a view — the island runs buildAllTasks, so the
// grouping toggle (board / owner) and the filters change without a round
// trip. The one thing the server decides is `since`, because the done pile
// is the only part of this page that could grow without bound.
//
// The page spans every board, so it is the whole tool's: a single-board
// grant does not reach it.
//
//   GET ?since=YYYY-MM-DD → { cards, boards, columns, people, today }

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards } from '@/lib/boards/access';
import { type APIRoute, beginRead, json, storeError } from '@/lib/boards/route';
import { loadAllTasks } from '@/lib/goals/store';
import { isYmd } from '@/lib/goals/validate';

/** How far back "Recently done" reaches unless the page asks for more. */
const DEFAULT_DONE_DAYS = 28;

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  if (!canManageBoards(ready.gate.access)) return json({ error: 'Forbidden' }, 403);

  const asked = url.searchParams.get('since');
  if (asked !== null && !isYmd(asked)) {
    return json({ error: 'since must be a YYYY-MM-DD date' }, 400);
  }
  const since =
    asked ?? new Date(Date.now() - DEFAULT_DONE_DAYS * 86_400_000).toISOString().slice(0, 10);

  try {
    return json(await loadAllTasks(ready.db, since));
  } catch (e) {
    return storeError('all-tasks', e);
  }
};
