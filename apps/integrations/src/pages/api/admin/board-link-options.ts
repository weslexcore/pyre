// What a `card_link` field may link: the cards on its target board that sit
// in the columns it offers, newest first, narrowed by what was typed. The
// drawer's picker reads it (CardLinkField).
//
// Gated on the field's *own* board, not the target: somebody holding only
// board:events can pick a practitioner for an event without being able to
// open the practitioners board. What comes back is a title, a board, and a
// column — enough to pick the right card, and the same the chip shows once
// it is picked. Opening that card still needs its board (`openable`).
//
// Making a new card on the target board from the field (the plus beside a
// linked-cards field in the drawer) is different: that writes to the other
// board, so it needs that board too. `?info=1` says whether this viewer may,
// and what the other board calls a card, so the plus shows only when it
// would work. The new card lands in the field's first offered column — open
// before finished — and comes back as a summary for the drawer to link; the
// link itself is made by the drawer's save, like any pick.
//
//   GET  ?field=<uuid>&q=<text>  → { options: LinkSummary[] }
//   GET  ?field=<uuid>&info=1    → { create: { noun, boardName } | null }
//   POST { field, title }        → { card: LinkSummary } 201

import { BOARDS_HREF, type PageAccess } from '@/components/admin/adminTools';
import { canViewBoard } from '@/lib/boards/access';
import { loadLinkSummaries } from '@/lib/boards/card-links';
import { defaultColumn } from '@/lib/boards/cards';
import { createCard } from '@/lib/boards/create-card';
import { linkColumnAllowed, markOpenable } from '@/lib/boards/links';
import { loadColumns } from '@/lib/boards/store';
import { BOARD_LIMITS } from '@/lib/boards/types';
import { parseCardCreate } from '@/lib/boards/validate';
import type { BoardColumnRow, BoardFieldRow, BoardRow } from '@/lib/db';
import {
  type APIRoute,
  beginMutation,
  beginRead,
  type Db,
  isUuidParam,
  json,
  storeError,
} from '@/lib/http/route';

/** Typed words as a title filter: ilike wildcards and PostgREST punctuation stripped. */
function searchTerm(raw: string | null): string {
  return (raw ?? '')
    .replace(/[%_,()*\\]/g, ' ')
    .trim()
    .slice(0, 100);
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, gate } = ready;

  const fieldId = url.searchParams.get('field');
  if (!isUuidParam(fieldId)) return json({ error: 'field must be a UUID' }, 400);

  try {
    const field = await loadLinkField(db, gate.access, fieldId);
    if (!field) return json({ error: 'Field not found' }, 404);

    if (url.searchParams.get('info') === '1') {
      const target = await creatableTarget(db, gate.access, field);
      return json({
        create: target ? { noun: target.board.card_noun, boardName: target.board.name } : null,
      });
    }
    if (field.kind !== 'card_link' || !field.link_board_id) return json({ options: [] });

    const columns = await offeredColumns(db, field);
    if (columns.length === 0) return json({ options: [] });

    let query = db
      .from('board_cards')
      .select('id')
      .eq('board_id', field.link_board_id)
      .in(
        'column_id',
        columns.map((column) => column.id)
      )
      .order('updated_at', { ascending: false })
      .limit(BOARD_LIMITS.linkOptions);
    const term = searchTerm(url.searchParams.get('q'));
    if (term) query = query.ilike('title', `%${term}%`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
    const order = new Map(ids.map((id, index) => [id, index]));
    const summaries = (await loadLinkSummaries(db, ids)).sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    );
    return json({
      options: markOpenable(summaries, (slug) => canViewBoard(gate.access, slug)),
    });
  } catch (e) {
    return storeError('board-link-options', e);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;

  const fieldId = typeof body.field === 'string' ? body.field : null;
  if (!isUuidParam(fieldId)) return json({ error: 'field must be a UUID' }, 400);

  try {
    const field = await loadLinkField(db, gate.access, fieldId);
    if (!field) return json({ error: 'Field not found' }, 404);
    if (field.archived) return json({ error: `"${field.label}" is retired` }, 400);
    const target = await creatableTarget(db, gate.access, field);
    if (!target) {
      return json({ error: `You can't add cards to the board "${field.label}" links to` }, 403);
    }
    if (!target.column) {
      return json({ error: `"${field.label}" offers no column a new card can go in` }, 400);
    }

    const parsed = parseCardCreate({ title: body.title, columnId: target.column.id });
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const created = await createCard(db, {
      boardSlug: target.board.slug,
      card: parsed.value,
      properties: {},
      actor: email,
    });
    if (!created.ok) return json({ error: created.error }, created.status);

    const [summary] = markOpenable(await loadLinkSummaries(db, [created.card.id]), (slug) =>
      canViewBoard(gate.access, slug)
    );
    if (!summary) return json({ error: 'The new card could not be read back' }, 500);
    return json({ card: summary }, 201);
  } catch (e) {
    return storeError('board-link-options', e);
  }
};

/**
 * The field, if the viewer may open its board. Not-found and not-yours look
 * the same, as on the card routes.
 */
async function loadLinkField(
  db: Db,
  access: PageAccess,
  fieldId: string
): Promise<BoardFieldRow | null> {
  const { data: fieldRow, error: fieldError } = await db
    .from('board_fields')
    .select('*')
    .eq('id', fieldId)
    .maybeSingle();
  if (fieldError) throw new Error(fieldError.message);
  const field = (fieldRow as BoardFieldRow | null) ?? null;
  const board = field ? await loadBoard(db, field.board_id) : null;
  if (!field || !board || !canViewBoard(access, board.slug)) return null;
  return field;
}

/**
 * The columns a field offers: an empty list offers every column still in
 * use; a named one is offered even once archived, since somebody chose it
 * on purpose.
 */
async function offeredColumns(db: Db, field: BoardFieldRow): Promise<BoardColumnRow[]> {
  if (!field.link_board_id) return [];
  return (await loadColumns(db, field.link_board_id)).filter((column) =>
    field.link_columns.length === 0 ? !column.archived : linkColumnAllowed(field, column.key)
  );
}

/**
 * The board a new linked card would go on, when this viewer may write to
 * it, and the column it would land in: the first live one the field
 * offers, open before finished (defaultColumn). Null when the field links
 * nowhere or the viewer cannot open that board.
 */
async function creatableTarget(
  db: Db,
  access: PageAccess,
  field: BoardFieldRow
): Promise<{
  board: Pick<BoardRow, 'slug' | 'name' | 'card_noun'>;
  column: BoardColumnRow | null;
} | null> {
  if (field.kind !== 'card_link' || !field.link_board_id) return null;
  const { data, error } = await db
    .from('boards')
    .select('slug, name, card_noun, archived')
    .eq('id', field.link_board_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const board = (data as Pick<BoardRow, 'slug' | 'name' | 'card_noun' | 'archived'>) ?? null;
  if (!board || board.archived || !canViewBoard(access, board.slug)) return null;
  const live = (await offeredColumns(db, field)).filter((column) => !column.archived);
  return { board, column: defaultColumn(live) };
}

async function loadBoard(db: Db, boardId: string): Promise<Pick<BoardRow, 'slug'> | null> {
  const { data, error } = await db.from('boards').select('slug').eq('id', boardId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Pick<BoardRow, 'slug'>) ?? null;
}
