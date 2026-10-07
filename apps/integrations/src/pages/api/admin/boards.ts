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
// Fields do not: a field dropped from the list is deleted along with its
// answers on every card, and one that should stop being asked while its
// answers stay is retired (archived) instead. A field's
// kind can be changed after the fact, and the answers already stored are
// read through the new kind and written back — what does not survive the
// change is cleared, the way an answer to a pick-one whose option is gone
// is cleared. A files field is the exception: its answers name rows holding
// real bytes, so it stays what it is.
//
// A card_link field is the other exception, for the same reason: its
// answers are rows in board_card_links naming another board's cards, so it
// stays a link field, and it keeps the board it links to. Its allowed
// columns and one-or-many can change freely. Asking for `linkInverse` on it
// creates the matching field on the target board and pairs the two, so the
// same links show from both ends.
//
// A checklist field is the third: its answers are a card's own list and who
// ticked what, which no other kind can hold, so it stays a checklist. Its
// default list and the column a finished card moves to can change freely;
// that column has to be a live one on this board when it is set.
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
//   GET                  → { boards, sections, goals, kpis, tallies, upNext, canManage,
//                            owners?, unattachedGoals? }
//   GET ?slug=<slug>     → { board, columns, fields, cards, goal, kpis, … }
//   POST   { slug, name, description?, cardNoun?, includeInAllTasks?,
//            goalId? | goal?, sectionId?, columns: [{ key, label, kind, sortOrder? }] }
//                        → { board, columns } 201
//   PATCH  { slug, name?, description?, cardNoun?, includeInAllTasks?,
//            defaultAssigneeEmails?, dueOnCalendar?, archived?, sortOrder?, goalId?, sectionId?,
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
import { deleteBoardAttachments, removeAttachments } from '@/lib/boards/card-media';
import { columnKeyOf } from '@/lib/boards/columns';
import { logBoardEvent } from '@/lib/boards/events';
import { boardViewerExtras, listAssignable } from '@/lib/boards/people';
import {
  attachGoalToBoard,
  goalExists,
  loadBoardBundle,
  loadBoards,
  loadBoardsIndex,
  loadColumns,
  loadSection,
  loadUpNext,
  unattachedGoals,
} from '@/lib/boards/store';
import {
  BOARD_LIMITS,
  FIELD_KIND_LABELS,
  GOALS_BOARD_SLUG,
  isBoardSlug,
  kindIsTime,
} from '@/lib/boards/types';
import {
  type ColumnInput,
  type FieldInput,
  type LinkInverseInput,
  normalizeAnswer,
  parseBoardCreate,
  parseBoardPatch,
} from '@/lib/boards/validate';
import type { BoardAttachmentRow, BoardCardRow, BoardFieldRow, BoardRow, GoalRow } from '@/lib/db';
import {
  type APIRoute,
  beginDelete,
  beginMutation,
  beginRead,
  type Db,
  dbError,
  json,
  sessionEmail,
  storeError,
} from '@/lib/http/route';
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
      return json({
        ...bundle,
        ...(await boardViewerExtras(bundle.cards, gate.access, slug, bundle.linkSummaries, {
          email: sessionEmail(gate),
          fields: bundle.fields,
          defaultAssignees: bundle.board.default_assignee_emails,
        })),
      });
    }

    const boards = visibleBoards(gate.access, await loadBoards(db));
    // The viewer's own next few dated cards, for the strip on top.
    const [index, next] = await Promise.all([
      loadBoardsIndex(db, boards),
      loadUpNext(db, sessionEmail(gate), boards),
    ]);
    const upNext = { upNext: next.cards, upNextTotal: next.total };
    const canManage = canManageBoards(gate.access);
    if (!canManage) return json({ ...index, ...upNext, canManage });

    // The New board form needs the roster and the goals nobody has claimed.
    const [owners, unattached] = await Promise.all([listAssignable(), unattachedGoals(db)]);
    return json({ ...index, ...upNext, canManage, owners, unattachedGoals: unattached });
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
    if (error) return dbError(error);
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
    return dbError(error);
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
    return dbError(columnError);
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
  if (loadError) return dbError(loadError);
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
    if (error) return dbError(error);
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
  if (afterError) return dbError(afterError);

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
  if (loadError) return dbError(loadError);
  const board = (row as BoardRow) ?? null;
  if (!board) return json({ error: 'Board not found' }, 404);

  const { data: cardRows, error: cardsError } = await db
    .from('board_cards')
    .select('id')
    .eq('board_id', board.id);
  if (cardsError) return dbError(cardsError);
  const cardIds = ((cardRows ?? []) as { id: string }[]).map((card) => card.id);

  // Columns, fields, cards, the cards' trails, and the attachment rows
  // cascade with the board; the files' objects do not, so they go first.
  // The goal does not: boards.goal_id is the only thing pointing at it, and
  // it goes back to being a goal nobody serves yet.
  await deleteBoardAttachments(db, board.id);
  const { error } = await db.from('boards').delete().eq('id', board.id);
  if (error) return dbError(error);

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
          ...(column.assignee_emails !== undefined
            ? { assignee_emails: column.assignee_emails }
            : {}),
          sort_order: column.sort_order,
          archived: column.archived,
        })
        .eq('id', current.id);
      if (error) return dbError(error);
    } else {
      const { error } = await db.from('board_columns').insert({ ...column, board_id: boardId });
      if (error) return dbError(error);
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
  if (heldError) return dbError(heldError);
  const occupied = new Set(((held ?? []) as { column_id: string }[]).map((row) => row.column_id));

  const toArchive = dropped.filter((column) => occupied.has(column.id)).map((c) => c.id);
  const toDelete = dropped.filter((column) => !occupied.has(column.id)).map((c) => c.id);

  if (toArchive.length > 0) {
    const { error } = await db.from('board_columns').update({ archived: true }).in('id', toArchive);
    if (error) return dbError(error);
  }
  if (toDelete.length > 0) {
    const { error } = await db.from('board_columns').delete().in('id', toDelete);
    if (error) return dbError(error);
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
 * Re-read every answer stored under one field through its new kind, and
 * write back what survives. A phone number typed into a text field is a
 * phone number; the word "maybe" is not a date, and it is cleared rather
 * than left behind as a value the field can no longer mean.
 *
 * Small on purpose: a board is a few hundred cards at the outside, and this
 * only runs on the save that changes a kind.
 */
async function convertAnswers(
  db: Db,
  boardId: string,
  field: FieldInput
): Promise<Response | null> {
  const { data, error } = await db
    .from('board_cards')
    .select('id, properties')
    .eq('board_id', boardId)
    .not(`properties->${field.key}`, 'is', null);
  if (error) return dbError(error);

  for (const card of (data ?? []) as Pick<BoardCardRow, 'id' | 'properties'>[]) {
    const properties = { ...card.properties };
    const converted = normalizeAnswer(field, properties[field.key]);
    if (converted === null) delete properties[field.key];
    else properties[field.key] = converted;
    const { error: writeError } = await db
      .from('board_cards')
      .update({ properties })
      .eq('id', card.id);
    if (writeError) return dbError(writeError);
  }
  return null;
}

/**
 * Reconcile a board's fields against the list that was sent: still listed
 * (update), new (insert), gone (delete, with its answers — deleteField).
 * Unlike a column, a field is not kept back for its answers: retiring it
 * (archived) is the way to keep them. A retired field keeps showing on a
 * card that answered it (CardDrawer) and is not offered to a new one.
 *
 * A field's kind can change, and the answers already on the cards are put
 * through the new kind when it does (convertAnswers). Files are the one
 * exception in both directions: those answers name rows in
 * board_attachments holding real bytes, and a kind change would strand them.
 */
async function applyFields(db: Db, boardId: string, next: FieldInput[]): Promise<Response | null> {
  const existing = await loadFields(db, boardId);
  const byKey = new Map(existing.map((field) => [field.key, field]));
  const wanted = new Set(next.map((field) => field.key));

  const recast: FieldInput[] = [];
  for (const field of next) {
    const current = byKey.get(field.key);
    if (!current || current.kind === field.kind) continue;
    if (current.kind === 'files' || field.kind === 'files') {
      const reason =
        current.kind === 'files'
          ? `"${current.label}" holds files, so it cannot become a ${FIELD_KIND_LABELS[field.kind].toLowerCase()} field`
          : `"${current.label}" already has answers, so it cannot become a files field`;
      return json({ error: `${reason}. Retire it and add a new one instead.` }, 400);
    }
    if (current.kind === 'checklist' || field.kind === 'checklist') {
      const reason =
        current.kind === 'checklist'
          ? `"${current.label}" is a checklist, so it cannot become a ${FIELD_KIND_LABELS[field.kind].toLowerCase()} field`
          : `"${current.label}" already has answers, so it cannot become a checklist`;
      return json({ error: `${reason}. Retire it and add a new one instead.` }, 400);
    }
    if (current.kind === 'card_link' || field.kind === 'card_link') {
      const reason =
        current.kind === 'card_link'
          ? `"${current.label}" links cards, so it cannot become a ${FIELD_KIND_LABELS[field.kind].toLowerCase()} field`
          : `"${current.label}" already has answers, so it cannot become a linked cards field`;
      return json({ error: `${reason}. Retire it and add a new one instead.` }, 400);
    }
    recast.push(field);
  }

  const linkProblem = await checkLinkTargets(db, next, byKey);
  if (linkProblem) return linkProblem;

  // Columns are applied before fields on the same save, so this reads the
  // list the board is about to have. A pointer left alone on a column that
  // has since been archived is not refused — it just stops moving cards.
  const destinations = next.filter(
    (field) =>
      field.kind === 'checklist' &&
      field.checklist_done_column !== null &&
      field.checklist_done_column !== byKey.get(field.key)?.checklist_done_column
  );
  if (destinations.length > 0) {
    const live = new Set(
      (await loadColumns(db, boardId))
        .filter((column) => !column.archived)
        .map((column) => column.key)
    );
    const missing = destinations.find((field) => !live.has(field.checklist_done_column as string));
    if (missing) {
      return json(
        { error: `"${missing.label}" moves finished cards to a column this board does not have` },
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
          kind: field.kind,
          label: field.label,
          options: field.options,
          hint: field.hint,
          show_on_card: field.show_on_card,
          show_label_on_card: field.show_label_on_card,
          show_on_calendar: field.show_on_calendar,
          calendar_time_key: field.calendar_time_key,
          // The board it links to is fixed once set (checkLinkTargets); which
          // of its columns, and how many, are not.
          link_columns: field.link_columns,
          link_multiple: field.link_multiple,
          checklist_md: field.checklist_md,
          checklist_done_column: field.checklist_done_column,
          sort_order: field.sort_order,
          archived: field.archived,
        })
        .eq('id', current.id);
      if (error) return dbError(error);
    } else {
      const { link_inverse: _inverse, ...row } = field;
      const { error } = await db.from('board_fields').insert({ ...row, board_id: boardId });
      if (error) return dbError(error);
    }
  }

  // After the rows exist, so the new half can point at the field it mirrors.
  const pairing = next.filter(
    (field) => field.kind === 'card_link' && field.link_inverse && !field.archived
  );
  if (pairing.length > 0) {
    const saved = new Map((await loadFields(db, boardId)).map((field) => [field.key, field]));
    for (const field of pairing) {
      const row = saved.get(field.key);
      if (!row || row.link_inverse_field_id) continue;
      const paired = await pairLinkField(db, row, field.link_inverse as LinkInverseInput);
      if (paired) return paired;
    }
  }

  // After the rows, so an answer is never read through a kind the field
  // does not have yet; a failure here leaves the field changed and the
  // answers as they were, which the next save puts right.
  for (const field of recast) {
    const failed = await convertAnswers(db, boardId, field);
    if (failed) return failed;
  }

  // A field taken off the list is deleted, answers and all: retiring it
  // (archived) is how a field stops being asked while its answers stay.
  const dropped = existing.filter((field) => !wanted.has(field.key));
  for (const field of dropped) {
    const failed = await deleteField(db, boardId, field);
    if (failed) return failed;
  }

  // parseFields refuses a date field timed by something that is not a live
  // time field — but only when both are on the list it was sent. The retire
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
    if (error) return dbError(error);
  }

  return null;
}

/**
 * A field gone for good, and its answers off every card with it — so a
 * field added later under the same key starts empty. A files field's
 * uploads go too, objects first (removeAttachments). A card_link field's
 * links cascade with its row; a partner on another board keeps its own
 * links and just stops being paired (link_inverse_field_id is set null).
 */
async function deleteField(
  db: Db,
  boardId: string,
  field: BoardFieldRow
): Promise<Response | null> {
  // Keys match ^[a-z][a-z0-9_]+$, so the JSON path is safe to build.
  const { data, error } = await db
    .from('board_cards')
    .select('id, properties')
    .eq('board_id', boardId)
    .not(`properties->${field.key}`, 'is', null);
  if (error) return dbError(error);

  for (const card of (data ?? []) as Pick<BoardCardRow, 'id' | 'properties'>[]) {
    const { [field.key]: _gone, ...properties } = card.properties;
    const { error: writeError } = await db
      .from('board_cards')
      .update({ properties })
      .eq('id', card.id);
    if (writeError) return dbError(writeError);
  }

  if (field.kind === 'files') {
    const { data: files, error: filesError } = await db
      .from('board_attachments')
      .select('id, storage_path')
      .eq('board_id', boardId)
      .eq('field_key', field.key);
    if (filesError) return dbError(filesError);
    await removeAttachments(db, (files ?? []) as Pick<BoardAttachmentRow, 'id' | 'storage_path'>[]);
  }

  const { error: deleteError } = await db.from('board_fields').delete().eq('id', field.id);
  if (deleteError) return dbError(deleteError);
  return null;
}

/**
 * Every card_link field on the list names a board that exists and columns
 * that board has, and a field that already links somewhere keeps linking
 * there: its answers are cards on that board, and pointing it elsewhere
 * would leave every one of them naming a card the field no longer offers.
 */
async function checkLinkTargets(
  db: Db,
  next: FieldInput[],
  existing: Map<string, BoardFieldRow>
): Promise<Response | null> {
  const links = next.filter((field) => field.kind === 'card_link');
  if (links.length === 0) return null;

  for (const field of links) {
    const current = existing.get(field.key);
    if (current?.link_board_id && current.link_board_id !== field.link_board_id) {
      return json(
        {
          error: `"${field.label}" already links cards on another board. Retire it and add a new one instead.`,
        },
        400
      );
    }
  }

  const boardIds = [
    ...new Set(links.map((field) => field.link_board_id).filter((id): id is string => id !== null)),
  ];
  const [boardsResult, columnsResult] = await Promise.all([
    db.from('boards').select('id').in('id', boardIds),
    db.from('board_columns').select('board_id, key').in('board_id', boardIds),
  ]);
  if (boardsResult.error) return dbError(boardsResult.error);
  if (columnsResult.error) return dbError(columnsResult.error);
  const boards = new Set(((boardsResult.data ?? []) as { id: string }[]).map((row) => row.id));
  const columns = new Set(
    ((columnsResult.data ?? []) as { board_id: string; key: string }[]).map(
      (row) => `${row.board_id}:${row.key}`
    )
  );

  for (const field of links) {
    // A board deleted since leaves the pointer null (on delete set null); an
    // untouched field in that state saves as it is.
    const current = existing.get(field.key);
    if (current && current.link_board_id === null) {
      field.link_board_id = null;
      delete field.link_inverse;
      continue;
    }
    if (!field.link_board_id) {
      return json({ error: `"${field.label}" needs a board to link cards from` }, 400);
    }
    if (!boards.has(field.link_board_id)) {
      return json({ error: `"${field.label}" links to a board that does not exist` }, 400);
    }
    // A column the field already offered may have been deleted since (an
    // empty column is deleted, not archived); the key matches no card, so it
    // saves as it is rather than blocking every save of this board's fields.
    const kept = new Set(current?.link_columns ?? []);
    const unknown = field.link_columns.find(
      (key) => !kept.has(key) && !columns.has(`${field.link_board_id}:${key}`)
    );
    if (unknown) {
      return json({ error: `"${field.label}" offers a column its board does not have` }, 400);
    }
  }
  return null;
}

/**
 * The far half of a two-way link: a card_link field on the target board,
 * linking back, pointed at `field` and pointed to by it. Any column of this
 * board may be linked from there; the target board's own settings narrow it.
 */
async function pairLinkField(
  db: Db,
  field: BoardFieldRow,
  inverse: LinkInverseInput
): Promise<Response | null> {
  const targetId = field.link_board_id;
  if (!targetId) return null;

  const theirs = await loadFields(db, targetId);
  if (theirs.filter((row) => !row.archived).length >= BOARD_LIMITS.fieldsPerBoard) {
    return json(
      {
        error: `The board "${field.label}" links to already has ${BOARD_LIMITS.fieldsPerBoard} fields, so the matching field can't be added there`,
      },
      400
    );
  }

  const { data, error } = await db
    .from('board_fields')
    .insert({
      board_id: targetId,
      key: columnKeyOf(
        inverse.label,
        theirs.map((row) => row.key)
      ),
      label: inverse.label,
      kind: 'card_link',
      options: [],
      link_board_id: field.board_id,
      link_columns: [],
      link_multiple: inverse.multiple,
      link_inverse_field_id: field.id,
      sort_order: Math.max(0, ...theirs.map((row) => row.sort_order)) + 10,
    })
    .select('id')
    .single();
  if (error) return dbError(error);

  const { error: pairError } = await db
    .from('board_fields')
    .update({ link_inverse_field_id: (data as { id: string }).id })
    .eq('id', field.id);
  if (pairError) return dbError(pairError);
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
