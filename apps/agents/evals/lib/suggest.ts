// Shared setup for the suggester evals. Each eval writes a fixture shift note
// (and, where it needs one, an open card) into the database `eve dev` reads —
// SUPABASE_URL / SUPABASE_AGENTS_SECRET_KEY pointed at a local or staging
// database, never production — opens a suggester session on it the way the
// integrations app does, and removes the fixtures afterwards. The session
// carries no run, so save_suggestions only validates (dry run) and nothing is
// filed for review.

import type { EveEvalTurn } from 'eve/evals';
import { getDb } from '../../agent/lib/db';

const EVAL_AUTHOR = 'suggester-eval@pyresauna.test';

export async function withShiftNote<T>(
  body: string,
  noteDate: string,
  fn: (noteId: string) => Promise<T>
): Promise<T> {
  const db = getDb();
  const { data, error } = await db
    .from('shift_notes')
    .insert({ body, note_date: noteDate, author_email: EVAL_AUTHOR })
    .select('id')
    .single();
  if (error) throw new Error(`fixture note: ${error.message}`);
  const id = (data as { id: string }).id;
  try {
    return await fn(id);
  } finally {
    await db.from('shift_notes').delete().eq('id', id);
  }
}

/** An open card on the Tasks board, removed afterwards. */
export async function withOpenCard<T>(
  title: string,
  notes: string,
  fn: (cardId: string) => Promise<T>
): Promise<T> {
  const db = getDb();
  const { data: board } = await db
    .from('boards')
    .select('id, goal_id')
    .eq('slug', 'goals')
    .single();
  const { data: column } = await db
    .from('board_columns')
    .select('id')
    .eq('board_id', (board as { id: string }).id)
    .eq('kind', 'open')
    .eq('archived', false)
    .order('sort_order')
    .limit(1)
    .single();
  const { data, error } = await db
    .from('board_cards')
    .insert({
      board_id: (board as { id: string }).id,
      goal_id: (board as { goal_id: string | null }).goal_id,
      column_id: (column as { id: string }).id,
      title,
      notes_md: notes,
      created_by: EVAL_AUTHOR,
    })
    .select('id')
    .single();
  if (error) throw new Error(`fixture card: ${error.message}`);
  const id = (data as { id: string }).id;
  try {
    return await fn(id);
  } finally {
    await db.from('board_cards').delete().eq('id', id);
  }
}

/** The headers the integrations app sends when it starts the suggester on a note. */
export function suggesterHeaders(noteId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-pyre-agent': 'suggester',
    'x-pyre-suggest-source': `shift_note:${noteId}`,
  };
}

export const OPENING_MESSAGE =
  'Suggest follow-up actions for the record in your context. Start with get_suggestion_context, and finish with exactly one save_suggestions call, even if it is empty.';

export interface SavedSuggestion {
  kind: string;
  payload: Record<string, unknown>;
}

/** What the agent last tried to save (a rejected save is retried with the whole list). */
export function lastSaved(turn: EveEvalTurn): SavedSuggestion[] {
  const saves = turn.toolCalls.filter((call) => call.name === 'save_suggestions');
  const input = saves[saves.length - 1]?.input as { suggestions?: SavedSuggestion[] } | undefined;
  return input?.suggestions ?? [];
}

/** The saved list, typed, inside a satisfies() predicate. */
export const asSaved = (value: unknown): SavedSuggestion[] => value as SavedSuggestion[];
