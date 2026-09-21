// The reads behind /admin/boards. Server-only: takes a service-role client,
// so nothing here may be imported from an island.
//
// A board page is one bundle — the board, its columns, its fields, its cards,
// and the goals those cards are filed under — because every one of them is
// needed to render a single column view, and five round trips to draw one
// page is four too many.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow, BoardRow, GoalRow } from '@/lib/db';
import { BOARD_LIMITS } from './types';

/** Every board, archived last, in display order. */
export async function loadBoards(db: SupabaseClient): Promise<BoardRow[]> {
  const { data, error } = await db
    .from('boards')
    .select('*')
    .order('archived', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoardRow[];
}

export async function loadBoardBySlug(db: SupabaseClient, slug: string): Promise<BoardRow | null> {
  const { data, error } = await db.from('boards').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BoardRow) ?? null;
}

export async function loadColumns(db: SupabaseClient, boardId: string): Promise<BoardColumnRow[]> {
  const { data, error } = await db
    .from('board_columns')
    .select('*')
    .eq('board_id', boardId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoardColumnRow[];
}

/** One column, used to check a move lands somewhere on the right board. */
export async function loadColumn(db: SupabaseClient, id: string): Promise<BoardColumnRow | null> {
  const { data, error } = await db.from('board_columns').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BoardColumnRow) ?? null;
}

export async function loadCard(db: SupabaseClient, id: string): Promise<BoardCardRow | null> {
  const { data, error } = await db.from('board_cards').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BoardCardRow) ?? null;
}

export interface BoardBundle {
  board: BoardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  cards: BoardCardRow[];
  /** Open goals, so a card's goal picker has something to offer. */
  goals: GoalRow[];
}

/** Everything one board page renders, or null when the slug names nothing. */
export async function loadBoardBundle(
  db: SupabaseClient,
  slug: string
): Promise<BoardBundle | null> {
  const board = await loadBoardBySlug(db, slug);
  if (!board) return null;

  const [columns, fieldsResult, cardsResult, goalsResult] = await Promise.all([
    loadColumns(db, board.id),
    db
      .from('board_fields')
      .select('*')
      .eq('board_id', board.id)
      .order('sort_order', { ascending: true }),
    db
      .from('board_cards')
      .select('*')
      .eq('board_id', board.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(BOARD_LIMITS.cardsPerBoard),
    db
      .from('goals')
      .select('*')
      .in('status', ['planned', 'active'])
      .order('sort_order', { ascending: true }),
  ]);

  if (fieldsResult.error) throw new Error(fieldsResult.error.message);
  if (cardsResult.error) throw new Error(cardsResult.error.message);
  if (goalsResult.error) throw new Error(goalsResult.error.message);

  return {
    board,
    columns,
    fields: (fieldsResult.data ?? []) as BoardFieldRow[],
    cards: (cardsResult.data ?? []) as BoardCardRow[],
    goals: (goalsResult.data ?? []) as GoalRow[],
  };
}

/** Every column on every board, for pages that span boards (All Tasks). */
export async function loadAllColumns(db: SupabaseClient): Promise<BoardColumnRow[]> {
  const { data, error } = await db
    .from('board_columns')
    .select('*')
    .order('board_id', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoardColumnRow[];
}
