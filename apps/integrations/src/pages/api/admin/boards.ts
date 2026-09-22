// Boards (/admin/boards): the column layouts cards live in, each carrying the
// goal it serves. The seeded `goals` board is the founders' task list;
// `rentals` is the first lead pipeline, and the shape every future one takes.
//
// Two levels of access, and the difference is the point of the tool. Anyone
// holding `board:<slug>` can open that board and work its cards
// (board-cards.ts) and measure its goal's KPIs (goal-kpis.ts). Reshaping the
// tool — creating a board, renaming one, editing its columns, setting or
// editing its goal, deleting it — needs the whole `/admin/boards` page, so
// the community manager running the rental pipeline can move a lead to
// Quoted without being able to add a column, a board, or a goal.
//
// Columns are never deleted out from under their cards. A column dropped
// from the list is archived if anything is sitting in it and removed only if
// nothing is — an archived column keeps rendering while it still holds work
// (lib/boards/cards.ts), so nothing is ever stranded somewhere invisible.
// Fields follow the same rule against the answers on the cards, with one
// more: a field's kind is permanent, because the answers already stored are
// shaped by it. Change of mind means archive it and add a new one.
//
// A board's goal travels with its cards: every card on the board is filed
// under the board's goal, and pointing the board at a different goal
// re-files them (lib/boards/store attachGoalToBoard).
//
// Deleting a board is the one erasing action here. It takes the board's
// columns, fields, cards, and their trails with it (the foreign keys
// cascade) and leaves the goal standing. The seeded Tasks board cannot go:
// All Tasks quick-adds into it.
//
//   GET                  → { boards, sections, goals, kpis, tallies, canManage,
//                            owners?, unattachedGoals? }
//   GET ?slug=<slug>     → { board, columns, fields, cards, goal, kpis, … }
//   POST   { slug, name, description?, cardNoun?, includeInAllTasks?,
//            goalId? | goal?, sectionId?, columns: [{ key, label, kind, sortOrder? }] }
//                        → { board, columns } 201
//   PATCH  { slug, name?, description?, cardNoun?, includeInAllTasks?,
//            dueOnCalendar?, archived?, sortOrder?, goalId?, sectionId?,
//            columns?, fields? }
//                        → { board, columns, fields }
//
// A field carries two more answers since the calendar: `showOnCalendar` (a
// date field is an event) and `calendarTimeKey` (the time field that times
// it). parseFields checks the pairing against the list it was sent; the
// sweep at the end of applyFields covers what one request cannot see.
//   DELETE ?slug=<slug>  → { ok: true, cards }

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards, canViewBoard, visibleBoards } from '@/lib/boards/access';
import { deleteBoardAttachments } from '@/lib/boards/card-media';
import { logBoardEvent } from '@/lib/boards/events';
import { boardViewerExtras, listAssignable } from '@/lib/boards/people';
import {
  type APIRoute,
  beginDelete,
  beginMutation,
  beginRead,
  type Db,
  json,
  storeError,
} from '@/lib/boards/route';
import {
  attachGoalToBoard,
  goalExists,
  loadBoardBundle,
  loadBoards,
  loadBoardsIndex,
  loadColumns,
  loadSection,
  unattachedGoals,
} from '@/lib/boards/store';
import { GOALS_BOARD_SLUG, isBoardSlug, kindIsTime } from '@/lib/boards/types';
import {
  type ColumnInput,
  type FieldInput,
  parseBoardCreate,
  parseBoardPatch,
} from '@/lib/boards/validate';
import type { BoardFieldRow, BoardRow, GoalRow } from '@/lib/db';
import { deleteBySourceIds } from '@/lib/notifications/notify';

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, gate } = ready;

  const slug = url.searchParams.get('slug');
  try {
    if (slug) {
      if (!isBoardSlug(slug)) return json({ error: 'slug is not a board slug' }, 400);
      // Not-found and not-yours look the same: a 403 would confirm the board
      // exists to somebody who was never meant to know the list.
      if (!canViewBoard(gate.access, slug)) return json({ error: 'Board not found' }, 404);
      const bundle = await loadBoardBundle(db, slug);
      if (!bundle) return json({ error: 'Board not found' }, 404);
      return json({ ...bundle, ...(await boardViewerExtras(bundle.cards, gate.access, slug)) });
    }

    const boards = visibleBoards(gate.access, await loadBoards(db));
    const index = await loadBoardsIndex(db, boards);
    const canManage = canManageBoards(gate.access);
    if (!canManage) return json({ ...index, canManage });

    // The New board form needs the roster and the goals nobody has claimed.
    const [owners, unattached] = await Promise.all([listAssignable(), unattachedGoals(db)]);
    return json({ ...index, canManage, owners, unattachedGoals: unattached });
  } catch (e) {
    return storeError('boards', e);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const parsed = parseBoardCreate(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { columns, goal: newGoal, ...board } = parsed.value;

  const { data: existing } = await db
    .from('boards')
    .select('slug')
    .eq('slug', board.slug)
    .maybeSingle();
  if (existing) return json({ error: `A board already uses the slug "${board.slug}"` }, 409);

  if (board.goal_id && !(await goalExists(db, board.goal_id))) {
    return json({ error: 'That goal does not exist' }, 400);
  }
  if (board.section_id && !(await loadSection(db, board.section_id))) {
    return json({ error: 'That section does not exist' }, 400);
  }

  // A goal written down with the board. Created first so the board can point
  // at it; undone if the board then fails, so no goal is left serving nothing.
  let createdGoal: GoalRow | null = null;
  if (newGoal) {
    const now = new Date().toISOString();
    const { data, error } = await db
      .from('goals')
      .insert({
        ...newGoal,
        started_at: newGoal.status === 'active' ? now : null,
        created_by: email,
      })
      .select('*')
      .single();
    if (error) return json({ error: error.message }, 500);
    createdGoal = data as GoalRow;
    board.goal_id = createdGoal.id;
  }

  const { data, error } = await db
    .from('boards')
    .insert({ ...board, sort_order: await nextBoardOrder(db), created_by: email })
    .select('*')
    .single();
  if (error) {
    if (createdGoal) await db.from('goals').delete().eq('id', createdGoal.id);
    return json({ error: error.message }, 500);
  }

  const created = data as BoardRow;
  const { error: columnError } = await db
    .from('board_columns')
    .insert(columns.map((column) => ({ ...column, board_id: created.id })));
  if (columnError) {
    // A board with no columns is unusable and un-fixable from the UI, so it
    // does not get to exist: undo the inserts rather than leave a husk.
    await db.from('boards').delete().eq('id', created.id);
    if (createdGoal) await db.from('goals').delete().eq('id', createdGoal.id);
    return json({ error: columnError.message }, 500);
  }

  if (createdGoal) {
    await logBoardEvent(db, { goalId: createdGoal.id, action: 'created', actor: email });
  }

  return json({ board: created, columns: await loadColumns(db, created.id) }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isBoardSlug(slug)) return json({ error: 'slug is not a board slug' }, 400);

  const parsed = parseBoardPatch(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { columns, fields, goal_id: goalId, ...patch } = parsed.value;

  const { data: existing, error: loadError } = await db
    .from('boards')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (loadError) return json({ error: loadError.message }, 500);
  const board = (existing as BoardRow) ?? null;
  if (!board) return json({ error: 'Board not found' }, 404);

  if (patch.section_id && !(await loadSection(db, patch.section_id))) {
    return json({ error: 'That section does not exist' }, 400);
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await db
      .from('boards')
      .update({ ...patch, updated_by: email })
      .eq('id', board.id);
    if (error) return json({ error: error.message }, 500);
  }

  if (goalId !== undefined && goalId !== board.goal_id) {
    if (goalId && !(await goalExists(db, goalId))) {
      return json({ error: 'That goal does not exist' }, 400);
    }
    try {
      await attachGoalToBoard(db, board, goalId, email);
    } catch (e) {
      return storeError('boards', e);
    }
  }

  if (columns) {
    const applied = await applyColumns(db, board.id, columns);
    if (applied) return applied;
  }

  if (fields) {
    const applied = await applyFields(db, board.id, fields);
    if (applied) return applied;
  }

  const { data: after, error: afterError } = await db
    .from('boards')
    .select('*')
    .eq('id', board.id)
    .single();
  if (afterError) return json({ error: afterError.message }, 500);

  return json({
    board: after as BoardRow,
    columns: await loadColumns(db, board.id),
    fields: await loadFields(db, board.id),
  });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const slug = url.searchParams.get('slug');
  if (!isBoardSlug(slug)) return json({ error: 'slug is not a board slug' }, 400);
  if (slug === GOALS_BOARD_SLUG) {
    return json(
      { error: 'The Tasks board is where All Tasks files quick-adds and cannot be deleted' },
      409
    );
  }

  const { data: row, error: loadError } = await db
    .from('boards')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (loadError) return json({ error: loadError.message }, 500);
  const board = (row as BoardRow) ?? null;
  if (!board) return json({ error: 'Board not found' }, 404);

  const { data: cardRows, error: cardsError } = await db
    .from('board_cards')
    .select('id')
    .eq('board_id', board.id);
  if (cardsError) return json({ error: cardsError.message }, 500);
  const cardIds = ((cardRows ?? []) as { id: string }[]).map((card) => card.id);

  // Columns, fields, cards, the cards' trails, and the attachment rows
  // cascade with the board; the files' objects do not, so they go first.
  // The goal does not: boards.goal_id is the only thing pointing at it, and
  // it goes back to being a goal nobody serves yet.
  await deleteBoardAttachments(db, board.id);
  const { error } = await db.from('boards').delete().eq('id', board.id);
  if (error) return json({ error: error.message }, 500);

  // A bell row pointing at a card that no longer exists is a dead end.
  await deleteBySourceIds(db, 'board_card', cardIds);

  console.info(`[boards] ${email} deleted board ${slug} (${cardIds.length} cards)`);
  return json({ ok: true, cards: cardIds.length });
};

/**
 * Reconcile a board's columns against the list that was sent. Keys are the
 * identity — a column keeps its id (and its cards) through a rename — and
 * the three cases are: still listed (update), gone but holding cards
 * (archive), gone and empty (delete).
 */
async function applyColumns(
  db: Db,
  boardId: string,
  next: ColumnInput[]
): Promise<Response | null> {
  const existing = await loadColumns(db, boardId);
  const byKey = new Map(existing.map((column) => [column.key, column]));
  const wanted = new Set(next.map((column) => column.key));

  for (const column of next) {
    const current = byKey.get(column.key);
    if (current) {
      const { error } = await db
        .from('board_columns')
        .update({
          label: column.label,
          kind: column.kind,
          sort_order: column.sort_order,
          archived: column.archived,
        })
        .eq('id', current.id);
      if (error) return json({ error: error.message }, 500);
    } else {
      const { error } = await db.from('board_columns').insert({ ...column, board_id: boardId });
      if (error) return json({ error: error.message }, 500);
    }
  }

  const dropped = existing.filter((column) => !wanted.has(column.key));
  if (dropped.length === 0) return null;

  const { data: held, error: heldError } = await db
    .from('board_cards')
    .select('column_id')
    .in(
      'column_id',
      dropped.map((column) => column.id)
    );
  if (heldError) return json({ error: heldError.message }, 500);
  const occupied = new Set(((held ?? []) as { column_id: string }[]).map((row) => row.column_id));

  const toArchive = dropped.filter((column) => occupied.has(column.id)).map((c) => c.id);
  const toDelete = dropped.filter((column) => !occupied.has(column.id)).map((c) => c.id);

  if (toArchive.length > 0) {
    const { error } = await db.from('board_columns').update({ archived: true }).in('id', toArchive);
    if (error) return json({ error: error.message }, 500);
  }
  if (toDelete.length > 0) {
    const { error } = await db.from('board_columns').delete().in('id', toDelete);
    if (error) return json({ error: error.message }, 500);
  }
  return null;
}

async function loadFields(db: Db, boardId: string): Promise<BoardFieldRow[]> {
  const { data, error } = await db
    .from('board_fields')
    .select('*')
    .eq('board_id', boardId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoardFieldRow[];
}

/**
 * Reconcile a board's fields against the list that was sent, the way
 * applyColumns does: still listed (update — but never the kind), new
 * (insert), gone but answered on some card (archive), gone and unanswered
 * (delete). An archived field keeps showing in a drawer while the card has
 * an answer under it (CardDrawer), so nothing typed is ever hidden.
 */
async function applyFields(db: Db, boardId: string, next: FieldInput[]): Promise<Response | null> {
  const existing = await loadFields(db, boardId);
  const byKey = new Map(existing.map((field) => [field.key, field]));
  const wanted = new Set(next.map((field) => field.key));

  for (const field of next) {
    const current = byKey.get(field.key);
    if (current && current.kind !== field.kind) {
      return json(
        {
          error: `"${current.label}" is a ${current.kind} field and the answers on the cards are shaped by that. Archive it and add a new one instead.`,
        },
        400
      );
    }
  }

  for (const field of next) {
    const current = byKey.get(field.key);
    if (current) {
      const { error } = await db
        .from('board_fields')
        .update({
          label: field.label,
          options: field.options,
          hint: field.hint,
          show_on_card: field.show_on_card,
          show_label_on_card: field.show_label_on_card,
          show_on_calendar: field.show_on_calendar,
          calendar_time_key: field.calendar_time_key,
          sort_order: field.sort_order,
          archived: field.archived,
        })
        .eq('id', current.id);
      if (error) return json({ error: error.message }, 500);
    } else {
      const { error } = await db.from('board_fields').insert({ ...field, board_id: boardId });
      if (error) return json({ error: error.message }, 500);
    }
  }

  const dropped = existing.filter((field) => !wanted.has(field.key));
  for (const field of dropped) {
    // Keys match ^[a-z][a-z0-9_]+$, so the JSON path is safe to build.
    const { count, error: countError } = await db
      .from('board_cards')
      .select('id', { count: 'exact', head: true })
      .eq('board_id', boardId)
      .not(`properties->${field.key}`, 'is', null);
    if (countError) return json({ error: countError.message }, 500);

    const { error } =
      (count ?? 0) > 0
        ? await db.from('board_fields').update({ archived: true }).eq('id', field.id)
        : await db.from('board_fields').delete().eq('id', field.id);
    if (error) return json({ error: error.message }, 500);
  }

  // parseFields refuses a date field timed by something that is not a live
  // time field — but only when both are on the list it was sent. The archive
  // and delete passes above can leave a pointer dangling on a field nobody
  // touched, so the last word is a sweep over what is actually stored. The
  // calendar would draw those entries all-day anyway; this keeps the rows
  // honest, so the settings panel never offers a pairing that is already gone.
  const stored = await loadFields(db, boardId);
  const live = new Set(
    stored.filter((field) => !field.archived && kindIsTime(field.kind)).map((field) => field.key)
  );
  const stale = stored
    .filter((field) => field.calendar_time_key !== null && !live.has(field.calendar_time_key))
    .map((field) => field.id);
  if (stale.length > 0) {
    const { error } = await db
      .from('board_fields')
      .update({ calendar_time_key: null })
      .in('id', stale);
    if (error) return json({ error: error.message }, 500);
  }

  return null;
}

async function nextBoardOrder(db: Db): Promise<number> {
  const { data } = await db
    .from('boards')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  return (((data ?? []) as { sort_order: number }[])[0]?.sort_order ?? 0) + 10;
}
