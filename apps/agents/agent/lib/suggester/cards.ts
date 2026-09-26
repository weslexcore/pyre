// Open cards that might already cover a piece of work, so the suggester
// comments on the existing card instead of proposing a duplicate. A simple
// term match over titles and notes, best matches first: the open card count
// is small enough to rank in memory. Read-only.

import { getDb } from '../db';
import { siteUrl } from '../knowledge/urls';

/** Open cards read per search; far above the number a team keeps open. */
const OPEN_CARD_SCAN = 1000;

interface CardRow {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  notes_md: string;
  due_date: string | null;
  updated_at: string;
}

export function searchTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 3)
    ),
  ].slice(0, 12);
}

/** Title matches count double: a card's title is what it is about. */
export function scoreCard(card: Pick<CardRow, 'title' | 'notes_md'>, terms: string[]): number {
  const title = card.title.toLowerCase();
  const notes = card.notes_md.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 2;
    else if (notes.includes(term)) score += 1;
  }
  return score;
}

export async function searchOpenCards(input: { query: string; board?: string; limit?: number }) {
  const terms = searchTerms(input.query);
  if (terms.length === 0) return { cards: [], note: 'Search with a few key words (3+ letters).' };

  const db = getDb();
  const { data: boardData, error: boardError } = await db
    .from('boards')
    .select('id, slug, name')
    .eq('archived', false);
  if (boardError) throw new Error(boardError.message);
  const boards = new Map(
    ((boardData ?? []) as { id: string; slug: string; name: string }[]).map((b) => [b.id, b])
  );
  const onBoard = input.board
    ? [...boards.values()].find((b) => b.slug === input.board)?.id
    : undefined;
  if (input.board && !onBoard) return { cards: [], note: `No active board "${input.board}".` };

  let query = db
    .from('board_cards')
    .select('id, board_id, column_id, title, notes_md, due_date, updated_at')
    .is('completed_at', null)
    .order('updated_at', { ascending: false })
    .limit(OPEN_CARD_SCAN);
  if (onBoard) query = query.eq('board_id', onBoard);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const cards = ((data ?? []) as CardRow[])
    .filter((card) => boards.has(card.board_id))
    .map((card) => ({ card, score: scoreCard(card, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.card.updated_at.localeCompare(a.card.updated_at))
    .slice(0, input.limit ?? 8);

  const columnIds = [...new Set(cards.map(({ card }) => card.column_id))];
  const { data: columnData } = columnIds.length
    ? await db.from('board_columns').select('id, label').in('id', columnIds)
    : { data: [] };
  const columns = new Map(
    ((columnData ?? []) as { id: string; label: string }[]).map((c) => [c.id, c.label])
  );

  return {
    cards: cards.map(({ card }) => {
      const board = boards.get(card.board_id);
      return {
        cardId: card.id,
        title: card.title,
        board: board?.slug,
        boardName: board?.name,
        column: columns.get(card.column_id) ?? null,
        dueDate: card.due_date,
        notes: card.notes_md.slice(0, 400),
        lastUpdated: card.updated_at.slice(0, 10),
        url: siteUrl(`/admin/boards/${board?.slug ?? ''}#card-${card.id}`),
      };
    }),
  };
}
