// Cards: one task or one lead. The same row either way — a task on the
// founders' board is a card filed under a goal, a lead on the rental board
// is a card with a contact email in its properties — which is why there is
// one route here and not two.
//
// Three things this route insists on, because none of them can be left to
// the caller:
//
//   * the column a card moves to belongs to the card's own board;
//   * entering a done/dropped column stamps completion and clears the
//     waiting-on badge (lib/boards/cards.ts), and leaving one un-stamps it;
//   * `properties` is normalized against *this* board's fields, dropping
//     keys the board does not have rather than storing whatever arrived.
//
// Access is per board: `board:<slug>` opens exactly that board's cards.
//
//   GET ?board=<slug>  → { board, columns, fields, cards, goals }
//   POST   { board, title, columnId?, goalId?, ownerEmail?, dueDate?,
//            waitingOn?, area?, notesMd?, properties? } → { card } 201
//   PATCH  { id, ...any of the above } → { card }
//   DELETE ?id=<uuid>  → { ok: true }

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards, canViewBoard } from '@/lib/boards/access';
import { columnPatch, defaultColumn, nextSortOrder } from '@/lib/boards/cards';
import { eventsForCardPatch } from '@/lib/boards/diff';
import { logBoardEvent, logBoardEvents } from '@/lib/boards/events';
import {
  type APIRoute,
  type Db,
  beginDelete,
  beginMutation,
  beginRead,
  isUuidParam,
  json,
  storeError,
} from '@/lib/boards/route';
import { loadBoardBundle, loadCard, loadColumn, loadColumns } from '@/lib/boards/store';
import { isBoardSlug } from '@/lib/boards/types';
import { normalizeProperties, parseCardCreate, parseCardPatch } from '@/lib/boards/validate';
import type { BoardCardRow, BoardFieldRow } from '@/lib/db';

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, BOARDS_HREF);
  if (ready instanceof Response) return ready;

  const slug = url.searchParams.get('board');
  if (!slug || !isBoardSlug(slug)) return json({ error: 'board must be a board slug' }, 400);
  if (!canViewBoard(ready.gate.access, slug)) return json({ error: 'Board not found' }, 404);

  try {
    const bundle = await loadBoardBundle(ready.db, slug);
    if (!bundle) return json({ error: 'Board not found' }, 404);
    return json({ ...bundle, canManage: canManageBoards(ready.gate.access) });
  } catch (e) {
    return storeError('board-cards', e);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;

  const slug = typeof body.board === 'string' ? body.board : '';
  if (!isBoardSlug(slug)) return json({ error: 'board must be a board slug' }, 400);
  if (!canViewBoard(gate.access, slug)) return json({ error: 'Board not found' }, 404);

  const parsed = parseCardCreate(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const { data: boardRow, error: boardError } = await db
    .from('boards')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (boardError) return json({ error: boardError.message }, 500);
  const board = (boardRow as { id: string }) ?? null;
  if (!board) return json({ error: 'Board not found' }, 404);

  const columns = await loadColumns(db, board.id);
  // A quick-add from a goal page names no column; it goes in the first open
  // one, which is what "add a task" means on a board with a To do list.
  const column = parsed.value.column_id
    ? columns.find((c) => c.id === parsed.value.column_id)
    : defaultColumn(columns);
  if (!column) return json({ error: 'That column is not on this board' }, 400);

  if (parsed.value.goal_id) {
    const refused = await refuseMissingGoal(db, parsed.value.goal_id);
    if (refused) return refused;
  }

  const fields = await loadFields(db, board.id);
  const { data: siblings } = await db
    .from('board_cards')
    .select('column_id, sort_order')
    .eq('board_id', board.id);

  const { data, error } = await db
    .from('board_cards')
    .insert({
      ...parsed.value,
      board_id: board.id,
      column_id: column.id,
      properties: normalizeProperties(fields, body.properties),
      sort_order: nextSortOrder(
        (siblings ?? []) as Pick<BoardCardRow, 'column_id' | 'sort_order'>[],
        column.id
      ),
      created_by: email,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const card = data as BoardCardRow;
  await logBoardEvent(db, { cardId: card.id, action: 'created', actor: email });
  return json({ card }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;

  if (!isUuidParam(body.id)) return json({ error: 'id must be a UUID' }, 400);

  const parsed = parseCardPatch(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const patch = parsed.value;

  const before = await loadCard(db, body.id);
  if (!before) return json({ error: 'Card not found' }, 404);

  const guard = await refuseUnlessOnAViewableBoard(db, before.board_id, gate.access);
  if (guard) return guard;

  // A move only counts if the destination is on this card's own board —
  // otherwise a card could be dragged onto a board its owner cannot see.
  let completion: ReturnType<typeof columnPatch> = null;
  if (patch.column_id && patch.column_id !== before.column_id) {
    const column = await loadColumn(db, patch.column_id);
    if (!column || column.board_id !== before.board_id) {
      return json({ error: 'That column is not on this board' }, 400);
    }
    completion = columnPatch(before, column, email, new Date().toISOString());
  }

  if (patch.goal_id) {
    const refused = await refuseMissingGoal(db, patch.goal_id);
    if (refused) return refused;
  }

  const properties =
    body.properties === undefined
      ? {}
      : {
          properties: normalizeProperties(
            await loadFields(db, before.board_id),
            body.properties,
            before.properties
          ),
        };

  const { data, error } = await db
    .from('board_cards')
    .update({ ...patch, ...(completion ?? {}), ...properties, updated_by: email })
    .eq('id', before.id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const card = data as BoardCardRow;
  // The completion columns ride along so that clearing a waiting-on badge on
  // the way into Done shows up in the trail as the change it is.
  const events = eventsForCardPatch(before, {
    ...patch,
    ...(completion ?? {}),
    ...properties,
  }).map((event) => ({
    ...event,
    cardId: card.id,
    actor: email,
  }));
  await logBoardEvents(db, events);

  return json({ card });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, gate } = ready;

  const id = url.searchParams.get('id');
  if (!isUuidParam(id)) return json({ error: 'id must be a UUID' }, 400);

  const card = await loadCard(db, id);
  if (!card) return json({ error: 'Card not found' }, 404);

  const guard = await refuseUnlessOnAViewableBoard(db, card.board_id, gate.access);
  if (guard) return guard;

  // board_events cascades with the card: a deleted card's trail has nothing
  // left to describe.
  const { error } = await db.from('board_cards').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  console.info(`[boards] ${email} deleted card ${id}`);
  return json({ ok: true });
};

async function loadFields(db: Db, boardId: string): Promise<BoardFieldRow[]> {
  const { data } = await db
    .from('board_fields')
    .select('*')
    .eq('board_id', boardId)
    .order('sort_order', { ascending: true });
  return (data ?? []) as BoardFieldRow[];
}

/** 404 unless this access opens the board the card is on. */
async function refuseUnlessOnAViewableBoard(
  db: Db,
  boardId: string,
  access: { isAdmin: boolean; pages: string[] }
): Promise<Response | null> {
  const { data } = await db.from('boards').select('slug').eq('id', boardId).maybeSingle();
  const slug = (data as { slug: string } | null)?.slug;
  if (!slug || !canViewBoard(access, slug)) return json({ error: 'Card not found' }, 404);
  return null;
}

/** A card can only be filed under a goal that exists. */
async function refuseMissingGoal(db: Db, goalId: string): Promise<Response | null> {
  const { data, error } = await db.from('goals').select('id').eq('id', goalId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  return data ? null : json({ error: 'That goal does not exist' }, 400);
}
