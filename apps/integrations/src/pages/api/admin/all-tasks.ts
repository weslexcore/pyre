// All Tasks (/admin/goals/tasks): the read behind the cross-goal page.
//
// It hands over rows, not a view — the island runs buildAllTasks, so the
// grouping toggle (goal / owner / board) and the filters change without a
// round trip. The one thing the server decides is `since`, because the done
// pile is the only part of this page that could grow without bound.
//
//   GET ?since=YYYY-MM-DD → { cards, goals, boards, columns, people, today }

import { GOALS_HREF } from '@/components/admin/adminTools';
import { type APIRoute, beginRead, json, storeError } from '@/lib/boards/route';
import { loadAllTasks } from '@/lib/goals/store';
import { isYmd } from '@/lib/goals/validate';

/** How far back "Recently done" reaches unless the page asks for more. */
const DEFAULT_DONE_DAYS = 28;

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, GOALS_HREF);
  if (ready instanceof Response) return ready;

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
