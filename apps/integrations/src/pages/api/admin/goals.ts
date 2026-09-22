// Goals: what a board is for. A goal is written down with its board (or
// attached to one afterwards, api/admin/boards.ts), judged by its KPIs
// (goal-kpis.ts), and advanced by the cards on the board that serves it
// (board-cards.ts). A single goal is read as part of its board's bundle
// (lib/boards/store); the GET here is the overview — every goal at once,
// for /admin/boards/all-goals.
//
// The one rule worth stating out loud: **nothing here closes a goal on its
// own.** A PATCH to status 'completed' is a person pressing a button, and the
// route records what was true at that moment — how many KPIs were met, how
// much work was still open — alongside the note they wrote. A goal with all
// twelve tasks done and a KPI short stays open until somebody decides
// otherwise, which is the judgement the Trello board had nowhere to put.
//
// Writing a goal is reshaping the tool, so every verb here needs the whole
// /admin/boards grant (canManageBoards). Measuring a KPI does not; see
// goal-kpis.ts.
//
//   GET    → { goals, kpis, boards, columns, cards, people, today }
//            (the whole tool's — a single-board grant does not reach it)
//   POST   { title, descriptionMd?, status?, ownerEmail?, area?, targetDate?,
//            boardSlug? } → { goal } 201   (boardSlug points that board at it)
//   PATCH  { id, ...any of the above, sortOrder?, completionNote? } → { goal }
//   DELETE ?id=<uuid>   → { ok: true }

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards } from '@/lib/boards/access';
import { eventsForGoalPatch } from '@/lib/boards/diff';
import { type BoardEventInput, logBoardEvent, logBoardEvents } from '@/lib/boards/events';
import {
  type APIRoute,
  beginDelete,
  beginMutation,
  beginRead,
  type Db,
  isUuidParam,
  json,
  storeError,
} from '@/lib/boards/route';
import { attachGoalToBoard, boardsForGoal, loadBoardBySlug, loadGoal } from '@/lib/boards/store';
import { isBoardSlug } from '@/lib/boards/types';
import type { BoardCardRow, BoardColumnRow, GoalKpiRow, GoalRow } from '@/lib/db';
import { completionPreview, goalStatusPatch } from '@/lib/goals/access';
import { loadGoalsOverview } from '@/lib/goals/store';
import { parseGoalCreate, parseGoalPatch } from '@/lib/goals/validate';
import { notifyGoalCompleted } from '@/lib/notifications/goals';
import { deleteBySource } from '@/lib/notifications/notify';

export const GET: APIRoute = async ({ cookies }) => {
  const ready = await beginRead(cookies, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  if (!canManageBoards(ready.gate.access)) return json({ error: 'Forbidden' }, 403);

  try {
    return json(await loadGoalsOverview(ready.db));
  } catch (e) {
    return storeError('goals', e);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const parsed = parseGoalCreate(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  // The board this goal is being written for, checked before anything is
  // written so a typo in the slug does not leave a goal serving nothing.
  let board = null;
  if (body.boardSlug !== undefined && body.boardSlug !== null && body.boardSlug !== '') {
    if (!isBoardSlug(body.boardSlug)) return json({ error: 'boardSlug is not a board slug' }, 400);
    board = await loadBoardBySlug(db, body.boardSlug);
    if (!board) return json({ error: 'Board not found' }, 404);
  }

  // A goal created straight into 'active' has started today; one created
  // planned has not started at all.
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('goals')
    .insert({
      ...parsed.value,
      started_at: parsed.value.status === 'active' ? now : null,
      created_by: email,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const goal = data as GoalRow;
  await logBoardEvent(db, { goalId: goal.id, action: 'created', actor: email });

  if (board) {
    try {
      await attachGoalToBoard(db, board, goal.id, email);
    } catch (e) {
      return storeError('goals', e);
    }
  }

  return json({ goal }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  if (!isUuidParam(body.id)) return json({ error: 'id must be a UUID' }, 400);
  const id = body.id;

  const parsed = parseGoalPatch(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const patch = parsed.value;

  const before = await loadGoal(db, id);
  if (!before) return json({ error: 'Goal not found' }, 404);

  const now = new Date().toISOString();
  // A status change is never just a column: it carries started_at the first
  // time a goal goes active and the completion stamp on the way in and out.
  const statusColumns =
    patch.status !== undefined ? goalStatusPatch(before, patch.status, email, now) : {};

  // Completion is a decision, so it is logged with the evidence in front of
  // the person who made it rather than as "status: active -> completed".
  const completing = patch.status === 'completed' && before.status !== 'completed';
  const preview = completing ? await previewFor(db, before) : null;

  const { data, error } = await db
    .from('goals')
    .update({ ...patch, ...statusColumns, updated_by: email })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const goal = data as GoalRow;

  const events: BoardEventInput[] = eventsForGoalPatch(before, { ...patch, ...statusColumns })
    // The completed event below says it better than a status line would.
    .filter((event) => !(completing && event.action === 'status_changed'))
    .map((event) => ({ ...event, goalId: id, actor: email }));

  if (completing && preview) {
    events.push({
      goalId: id,
      action: 'completed',
      actor: email,
      detail: { ...preview },
      note: goal.completion_note,
    });
  }
  await logBoardEvents(db, events);

  // The moment the tool exists for: the person driving the goal hears that
  // somebody else called it met, with the note they wrote. The link opens
  // the board that serves the goal.
  if (completing && preview) {
    const [board] = await boardsForGoal(db, goal.id);
    await notifyGoalCompleted(db, goal, board ?? null, preview, email);
  }

  return json({ goal });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const id = url.searchParams.get('id');
  if (!isUuidParam(id)) return json({ error: 'id must be a UUID' }, 400);

  // Deleting a goal that a board serves or that carries work would either
  // orphan the cards or take the board's purpose away under it, and neither
  // is what anybody means by "remove this". 'dropped' is: it keeps the goal,
  // its tasks, and the reasoning. Detaching it from the board is the other.
  const [boards, { count: cardCount, error: cardError }] = await Promise.all([
    boardsForGoal(db, id),
    db.from('board_cards').select('id', { count: 'exact', head: true }).eq('goal_id', id),
  ]);
  if (cardError) return json({ error: cardError.message }, 500);

  if (boards.length > 0) {
    return json(
      { error: `The board "${boards[0].name}" serves this goal. Detach it there first.` },
      409
    );
  }
  if ((cardCount ?? 0) > 0) {
    return json({ error: 'This goal has tasks filed under it. Mark it dropped instead.' }, 409);
  }

  const { error } = await db.from('goals').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  // Nothing left for a bell row to open.
  await deleteBySource(db, 'goal', id);

  console.info(`[goals] ${email} deleted goal ${id}`);
  return json({ ok: true });
};

/** The KPI and open-task counts a completion is recorded against. */
async function previewFor(db: Db, goal: GoalRow) {
  const [kpisResult, cardsResult, columnsResult] = await Promise.all([
    db.from('goal_kpis').select('*').eq('goal_id', goal.id),
    db.from('board_cards').select('*').eq('goal_id', goal.id),
    db.from('board_columns').select('*'),
  ]);

  const columns = new Map(
    ((columnsResult.data ?? []) as BoardColumnRow[]).map((column) => [column.id, column])
  );
  return completionPreview(
    (kpisResult.data ?? []) as GoalKpiRow[],
    (cardsResult.data ?? []) as BoardCardRow[],
    columns
  );
}
