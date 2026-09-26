// Cards: one task or one lead. The same row either way — a task on the
// founders' board is a card filed under the board's goal, a lead on the
// rental board is a card with a contact email in its properties — which is
// why there is one route here and not two.
//
// Four things this route insists on, because none of them can be left to
// the caller:
//
//   * a card's goal is its board's goal. The body never names one; a new
//     card takes the board's, and changing the board's goal re-files every
//     card on it (api/admin/boards.ts);
//   * the column a card moves to belongs to the card's own board;
//   * entering a done/dropped column stamps completion and clears the
//     waiting-on badge (lib/boards/cards.ts), and leaving one un-stamps it;
//   * `properties` is normalized against *this* board's fields, dropping
//     keys the board does not have rather than storing whatever arrived;
//   * a `files` answer is settled around the write (lib/boards/card-media):
//     ids that name nothing this card may list are dropped before, and the
//     rows it now lists are claimed and the ones it dropped removed after.
//
// Access is per board: `board:<slug>` opens exactly that board's cards.
//
//   GET ?board=<slug>  → { board, columns, fields, cards, goal, kpis, … }
//   POST   { board, title, columnId?, ownerEmail?, dueDate?,
//            waitingOn?, area?, notesMd?, properties? } → { card } 201
//   PATCH  { id, ...any of the above } → { card }
//   DELETE ?id=<uuid>  → { ok: true }

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards, canViewBoard } from '@/lib/boards/access';
import {
  deleteCardAttachments,
  filterFileAnswers,
  syncCardAttachments,
} from '@/lib/boards/card-media';
import { columnPatch } from '@/lib/boards/cards';
import { createCard, goalTitle, loadBoardFields } from '@/lib/boards/create-card';
import { eventsForCardPatch } from '@/lib/boards/diff';
import { logBoardEvents } from '@/lib/boards/events';
import { boardViewerExtras } from '@/lib/boards/people';
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
import { loadBoardBundle, loadCard, loadColumn, unattachedGoals } from '@/lib/boards/store';
import { isBoardSlug } from '@/lib/boards/types';
import { normalizeProperties, parseCardCreate, parseCardPatch } from '@/lib/boards/validate';
import type { BoardCardRow, BoardRow } from '@/lib/db';
import { notifyCardAssigned, notifyCardCompleted } from '@/lib/notifications/goals';
import { deleteBySource } from '@/lib/notifications/notify';

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, BOARDS_HREF);
  if (ready instanceof Response) return ready;

  const slug = url.searchParams.get('board');
  if (!slug || !isBoardSlug(slug)) return json({ error: 'board must be a board slug' }, 400);
  if (!canViewBoard(ready.gate.access, slug)) return json({ error: 'Board not found' }, 404);

  try {
    const bundle = await loadBoardBundle(ready.db, slug);
    if (!bundle) return json({ error: 'Board not found' }, 404);
    // A manager on a board with no goal is offered the goals nobody serves.
    const extras = await boardViewerExtras(bundle.cards, ready.gate.access, slug);
    const offered =
      !bundle.goal && canManageBoards(ready.gate.access)
        ? { unattachedGoals: await unattachedGoals(ready.db) }
        : {};
    return json({ ...bundle, ...extras, ...offered });
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

  const created = await createCard(db, {
    boardSlug: slug,
    card: parsed.value,
    properties: body.properties,
    actor: email,
  });
  if (!created.ok) return json({ error: created.error }, created.status);
  const { card } = created;

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

  const fields = body.properties === undefined ? [] : await loadBoardFields(db, before.board_id);
  const properties =
    body.properties === undefined
      ? {}
      : {
          properties: await filterFileAnswers(
            db,
            before.board_id,
            before.id,
            fields,
            normalizeProperties(fields, body.properties, before.properties)
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
  if (properties.properties) {
    await syncCardAttachments(db, card.id, fields, before.properties, card.properties);
  }
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

  const assigned = card.owner_email !== null && card.owner_email !== before.owner_email;
  const justFinished = card.completed_at !== null && before.completed_at === null;
  if (assigned || justFinished) {
    const board = await loadBoard(db, card.board_id);
    if (board) {
      if (assigned) {
        await notifyCardAssigned(db, card, board, await goalTitle(db, card.goal_id), email);
      }
      // Only the owner hears, and only when somebody else finished it —
      // notifyCardCompleted drops the case where they did it themselves.
      if (justFinished) {
        const column = await loadColumn(db, card.column_id);
        if (column) await notifyCardCompleted(db, card, board, column, email);
      }
    }
  }

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

  // board_events and board_attachments cascade with the card: a deleted
  // card's trail has nothing left to describe. The bucket does not cascade,
  // so the files' objects go first.
  await deleteCardAttachments(db, id);
  const { error } = await db.from('board_cards').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  // A bell row pointing at a card that no longer exists is a dead end.
  await deleteBySource(db, 'board_card', id);

  console.info(`[boards] ${email} deleted card ${id}`);
  return json({ ok: true });
};

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

async function loadBoard(db: Db, boardId: string): Promise<BoardRow | null> {
  const { data } = await db.from('boards').select('*').eq('id', boardId).maybeSingle();
  return (data as BoardRow) ?? null;
}
