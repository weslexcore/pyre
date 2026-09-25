// Making a card, wherever the request came from: the board's own quick-add
// (api/admin/board-cards.ts) and an admin approving an agent's suggestion
// (lib/suggestions/kinds/board-card-create.ts). Server-only.
//
// The rules the board-cards route insists on live here so every path keeps
// them: the card takes its board's goal, lands in the named column only if
// that column is on this board (else the first open one), and its
// `properties` are normalized against this board's fields, with any `files`
// answer settled around the write.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BoardCardRow, BoardFieldRow, BoardRow } from '@/lib/db';
import { notifyCardAssigned } from '@/lib/notifications/goals';
import { filterFileAnswers, syncCardAttachments } from './card-media';
import { defaultColumn, nextSortOrder } from './cards';
import { logBoardEvent } from './events';
import { loadColumns } from './store';
import type { CardCreate } from './validate';
import { normalizeProperties } from './validate';

export interface CreateCardInput {
  boardSlug: string;
  /** The parsed card columns (parseCardCreate). */
  card: CardCreate;
  /** Raw answers keyed by field key; normalized against the board's fields here. */
  properties: unknown;
  /** Who made it: the actor on the row, its created event, and any notification. */
  actor: string;
  source?: BoardCardRow['source'];
  suggestionId?: string | null;
  /** Extra detail on the `created` event (e.g. where a suggestion came from). */
  eventDetail?: Record<string, unknown>;
}

export type CreateCardResult =
  | { ok: true; card: BoardCardRow; board: Pick<BoardRow, 'id' | 'slug' | 'name'> }
  | { ok: false; status: 400 | 404 | 500; error: string };

export async function loadBoardFields(
  db: SupabaseClient,
  boardId: string
): Promise<BoardFieldRow[]> {
  const { data } = await db
    .from('board_fields')
    .select('*')
    .eq('board_id', boardId)
    .order('sort_order', { ascending: true });
  return (data ?? []) as BoardFieldRow[];
}

export async function createCard(
  db: SupabaseClient,
  input: CreateCardInput
): Promise<CreateCardResult> {
  const { data: boardRow, error: boardError } = await db
    .from('boards')
    .select('id, slug, name, goal_id')
    .eq('slug', input.boardSlug)
    .maybeSingle();
  if (boardError) return { ok: false, status: 500, error: boardError.message };
  const board = (boardRow as Pick<BoardRow, 'id' | 'slug' | 'name' | 'goal_id'>) ?? null;
  if (!board) return { ok: false, status: 404, error: 'Board not found' };

  const columns = await loadColumns(db, board.id);
  // A quick-add from a goal page names no column; it goes in the first open
  // one, which is what "add a task" means on a board with a To do list.
  const column = input.card.column_id
    ? columns.find((c) => c.id === input.card.column_id)
    : defaultColumn(columns);
  if (!column) return { ok: false, status: 400, error: 'That column is not on this board' };

  const fields = await loadBoardFields(db, board.id);
  const { data: siblings } = await db
    .from('board_cards')
    .select('column_id, sort_order')
    .eq('board_id', board.id);

  const properties = await filterFileAnswers(
    db,
    board.id,
    null,
    fields,
    normalizeProperties(fields, input.properties)
  );

  const { data, error } = await db
    .from('board_cards')
    .insert({
      ...input.card,
      board_id: board.id,
      column_id: column.id,
      // Filed under the board's goal, whatever the board's goal is today.
      goal_id: board.goal_id,
      properties,
      sort_order: nextSortOrder(
        (siblings ?? []) as Pick<BoardCardRow, 'column_id' | 'sort_order'>[],
        column.id
      ),
      created_by: input.actor,
      ...(input.source ? { source: input.source } : {}),
      ...(input.suggestionId ? { suggestion_id: input.suggestionId } : {}),
    })
    .select('*')
    .single();
  if (error) return { ok: false, status: 500, error: error.message };

  const card = data as BoardCardRow;
  await syncCardAttachments(db, card.id, fields, {}, card.properties);
  await logBoardEvent(db, {
    cardId: card.id,
    action: 'created',
    actor: input.actor,
    ...(input.eventDetail ? { detail: input.eventDetail } : {}),
  });

  if (card.owner_email) {
    const { data: full } = await db
      .from('boards')
      .select('*')
      .eq('id', card.board_id)
      .maybeSingle();
    if (full) {
      await notifyCardAssigned(
        db,
        card,
        full as BoardRow,
        await goalTitle(db, card.goal_id),
        input.actor
      );
    }
  }

  return { ok: true, card, board: { id: board.id, slug: board.slug, name: board.name } };
}

/** The goal a card is filed under, by title — for the notification's detail line. */
export async function goalTitle(db: SupabaseClient, goalId: string | null): Promise<string | null> {
  if (!goalId) return null;
  const { data } = await db.from('goals').select('title').eq('id', goalId).maybeSingle();
  return (data as { title: string } | null)?.title ?? null;
}
