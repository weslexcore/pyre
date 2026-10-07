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
//     rows it now lists are claimed and the ones it dropped removed after;
//   * a `card_link` answer is never stored on the card (lib/boards/card-links):
//     the links it asks for are checked before, made and undone in
//     board_card_links after, and read back onto the card that is returned;
//   * a `checklist` answer says which items are done, never who did them:
//     every new mark is stamped with the session and the time here, and a
//     save that finishes a checklist whose field names a column moves the
//     card there (lib/boards/checklist.ts), unless the same save moves it
//     somewhere itself;
//   * finishing a repeating card sends it back to the board's first open
//     column, due on its next date (lib/boards/repeat-card.ts); the
//     response carries the card as it is after that.
//
// Access is per board: `board:<slug>` opens exactly that board's cards.
//
//   GET ?board=<slug>  → { board, columns, fields, cards, goal, kpis, … }
//   POST   { board, title, columnId?, assigneeEmails?, dueDate?, repeat?,
//            waitingOn?, area?, notesMd?, properties? } → { card } 201
//          (no assignees takes the board's defaults; repeat is
//          { every, unit } or null)
//   PATCH  { id, ...any of the above } → { card }
//   DELETE ?id=<uuid>  → { ok: true }

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards, canViewBoard } from '@/lib/boards/access';
import { applyLinks, prepareLinks, withLinks } from '@/lib/boards/card-links';
import {
  deleteCardAttachments,
  filterFileAnswers,
  syncCardAttachments,
} from '@/lib/boards/card-media';
import { columnPatch } from '@/lib/boards/cards';
import { checklistDestination, stampChecklists } from '@/lib/boards/checklist';
import { createCard, goalTitle, loadBoardFields } from '@/lib/boards/create-card';
import { eventsForCardPatch } from '@/lib/boards/diff';
import { logBoardEvents } from '@/lib/boards/events';
import { boardViewerExtras } from '@/lib/boards/people';
import { restartRepeat } from '@/lib/boards/repeat-card';
import { loadBoardSops, sopsForViewer } from '@/lib/boards/sops';
import {
  loadBoardBundle,
  loadCard,
  loadColumn,
  loadColumns,
  unattachedGoals,
} from '@/lib/boards/store';
import { isBoardSlug } from '@/lib/boards/types';
import { normalizeProperties, parseCardCreate, parseCardPatch } from '@/lib/boards/validate';
import type { BoardCardRow, BoardRow } from '@/lib/db';
import {
  type APIRoute,
  beginDelete,
  beginMutation,
  beginRead,
  type Db,
  dbError,
  isUuidParam,
  json,
  sessionEmail,
  storeError,
} from '@/lib/http/route';
import { notifyCardAssigned, notifyCardCompleted } from '@/lib/notifications/goals';
import { deleteBySource } from '@/lib/notifications/notify';
import { getSopRole } from '@/lib/sops/role';

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
    const { access } = ready.gate;
    const email = sessionEmail(ready.gate);
    const [extras, linkedSops, role] = await Promise.all([
      boardViewerExtras(bundle.cards, access, slug, bundle.linkSummaries, {
        email,
        fields: bundle.fields,
        defaultAssignees: bundle.board.default_assignee_emails,
      }),
      loadBoardSops(ready.db, bundle.board.id),
      getSopRole(email, access),
    ]);
    // The SOPs linked to this board that this viewer may open (lib/boards/sops).
    const sops = sopsForViewer(linkedSops, access, { role, email });
    const offered =
      !bundle.goal && canManageBoards(access)
        ? { unattachedGoals: await unattachedGoals(ready.db) }
        : {};
    return json({ ...bundle, ...extras, ...offered, sops });
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

  // Links are checked before anything is written, so a refused link refuses
  // the whole save rather than half of it.
  const fields = await loadBoardFields(db, before.board_id);
  const now = new Date().toISOString();
  const normalized =
    body.properties === undefined
      ? null
      : stampChecklists(
          fields,
          before.properties,
          normalizeProperties(fields, body.properties, before.properties),
          email,
          now
        );
  const prepared =
    normalized === null
      ? null
      : await prepareLinks(db, before.id, fields, normalized, body.properties);
  if (prepared && !prepared.ok) return json({ error: prepared.error }, 400);

  // A checklist this save finishes moves the card to its field's column —
  // unless the save is moving the card itself, which is the person's call.
  if (normalized && patch.column_id === undefined) {
    const destination = checklistDestination(
      fields,
      await loadColumns(db, before.board_id),
      before.column_id,
      before.properties,
      normalized
    );
    if (destination) {
      patch.column_id = destination.id;
      completion = columnPatch(before, destination, email, now);
    }
  }
  const properties = prepared
    ? {
        properties: await filterFileAnswers(
          db,
          before.board_id,
          before.id,
          fields,
          prepared.properties
        ),
      }
    : {};

  // A column hands the card to its own assignees, unless this save names
  // who the card is on: then the person picked, and that stands.
  if (completion && patch.assignee_emails !== undefined) {
    const { assignee_emails: _handoff, ...rest } = completion;
    completion = rest;
  }

  const { data, error } = await db
    .from('board_cards')
    .update({ ...patch, ...(completion ?? {}), ...properties, updated_by: email })
    .eq('id', before.id)
    .select('*')
    .single();
  if (error) return dbError(error);

  let written = data as BoardCardRow;
  if (properties.properties) {
    await syncCardAttachments(db, written.id, fields, before.properties, written.properties);
  }
  if (prepared?.ok) await applyLinks(db, written, fields, prepared.links, email);

  // Events for this save first, so the finished card's trail reads in the
  // order it happened: moved to Done, then stopped repeating.
  // The completion columns ride along so that clearing a waiting-on badge on
  // the way into Done shows up in the trail as the change it is.
  const events = eventsForCardPatch(before, {
    ...patch,
    ...(completion ?? {}),
    ...properties,
  }).map((event) => ({
    ...event,
    cardId: written.id,
    actor: email,
  }));
  await logBoardEvents(db, events);

  // A repeating card that was just finished goes straight back to the
  // first open column for its next round; the finished state it had is
  // what the completion notice below describes.
  const justFinished = written.completed_at !== null && before.completed_at === null;
  const finished = written;
  const restarted = justFinished ? await restartRepeat(db, written, email) : null;
  if (restarted) written = restarted;
  const [card] = await withLinks(db, fields, [written]);
  const added = card.assignee_emails.filter((who) => !before.assignee_emails.includes(who));
  if (added.length > 0 || justFinished) {
    const board = await loadBoard(db, card.board_id);
    if (board) {
      if (added.length > 0) {
        await notifyCardAssigned(db, card, board, await goalTitle(db, card.goal_id), email, added);
      }
      // Only the assignees hear, and only when somebody else finished it —
      // notifyCardCompleted drops the case where they did it themselves.
      if (justFinished) {
        const column = await loadColumn(db, finished.column_id);
        if (column) await notifyCardCompleted(db, finished, board, column, email);
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
  if (error) return dbError(error);

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
