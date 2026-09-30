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
//   GET ?field=<uuid>&q=<text>  → { options: LinkSummary[] }

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canViewBoard } from '@/lib/boards/access';
import { loadLinkSummaries } from '@/lib/boards/card-links';
import { linkColumnAllowed, markOpenable } from '@/lib/boards/links';
import { loadColumns } from '@/lib/boards/store';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardFieldRow, BoardRow } from '@/lib/db';
import { type APIRoute, beginRead, type Db, isUuidParam, json, storeError } from '@/lib/http/route';

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
    const { data: fieldRow, error: fieldError } = await db
      .from('board_fields')
      .select('*')
      .eq('id', fieldId)
      .maybeSingle();
    if (fieldError) throw new Error(fieldError.message);
    const field = (fieldRow as BoardFieldRow | null) ?? null;
    const board = field ? await loadBoard(db, field.board_id) : null;
    // Not-found and not-yours look the same, as on the card routes.
    if (!field || !board || !canViewBoard(gate.access, board.slug)) {
      return json({ error: 'Field not found' }, 404);
    }
    if (field.kind !== 'card_link' || !field.link_board_id) return json({ options: [] });

    // An empty list offers every column still in use; a named one is offered
    // even once archived, since somebody chose it on purpose.
    const columns = (await loadColumns(db, field.link_board_id)).filter((column) =>
      field.link_columns.length === 0 ? !column.archived : linkColumnAllowed(field, column.key)
    );
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

async function loadBoard(db: Db, boardId: string): Promise<Pick<BoardRow, 'slug'> | null> {
  const { data, error } = await db.from('boards').select('slug').eq('id', boardId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Pick<BoardRow, 'slug'>) ?? null;
}
