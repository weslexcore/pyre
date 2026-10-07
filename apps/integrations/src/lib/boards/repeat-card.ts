// Starting a repeating card's next round. Server-only.
//
// Called by the routes once a card has been finished (moved into a done or
// dropped column, by hand or by its checklist). A repeating card is one
// standing task, not a series of copies: finishing it sends the same card
// back to the board's first open column, due on the next date, so it can be
// done again. Its notes, answers, files, and links stay with it; a checklist
// starts again from its field's default, since ticking it off was this
// round's work. The round that was finished is kept in the card's trail.
//
// The reset is conditional on the card still sitting finished in the column
// it was finished in, so two saves racing to finish it reset it once.

import { todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BoardCardRow, BoardFieldValue } from '@/lib/db';
import { defaultColumn, nextSortOrder } from './cards';
import { loadBoardFields } from './create-card';
import { logBoardEvent } from './events';
import { nextRepeatDate, repeatRuleOf } from './recurrence';
import { loadColumns } from './store';
import { kindIsChecklist } from './types';

/**
 * `card`, just finished, back in its board's first open column and due on
 * its next date. Null when it does not repeat, is not finished, has nowhere
 * open to go, or another save already reset it.
 */
export async function restartRepeat(
  db: SupabaseClient,
  card: BoardCardRow,
  actor: string,
  today: string = todayEastern()
): Promise<BoardCardRow | null> {
  const rule = repeatRuleOf(card);
  if (!rule || card.completed_at === null) return null;

  const columns = await loadColumns(db, card.board_id);
  const column = defaultColumn(columns);
  // A board whose only live columns are finished ones has nowhere to put it.
  if (column?.kind !== 'open') return null;

  const fields = await loadBoardFields(db, card.board_id);
  const checklists = new Set(
    fields.filter((field) => kindIsChecklist(field.kind)).map((field) => field.key)
  );
  const properties: Record<string, BoardFieldValue> = {};
  for (const [key, value] of Object.entries(card.properties)) {
    if (!checklists.has(key)) properties[key] = value;
  }

  const { data: siblings } = await db
    .from('board_cards')
    .select('column_id, sort_order')
    .eq('board_id', card.board_id);

  const dueDate = nextRepeatDate(card.due_date, rule, today);
  const { data, error } = await db
    .from('board_cards')
    .update({
      column_id: column.id,
      completed_at: null,
      completed_by: null,
      due_date: dueDate,
      // On whoever owns the column it lands in, if anyone does; otherwise
      // on the people who had it.
      assignee_emails: column.assignee_emails?.length
        ? column.assignee_emails
        : card.assignee_emails,
      properties,
      sort_order: nextSortOrder(
        (siblings ?? []) as Pick<BoardCardRow, 'column_id' | 'sort_order'>[],
        column.id
      ),
      updated_by: actor,
    })
    .eq('id', card.id)
    .eq('column_id', card.column_id)
    .not('completed_at', 'is', null)
    .select('*')
    .single();
  if (error) {
    // PGRST116: no row matched, so another save has already reset it.
    if (error.code !== 'PGRST116') {
      console.warn('[boards] could not start the next round of a repeat:', error.message);
    }
    return null;
  }

  await logBoardEvent(db, {
    cardId: card.id,
    action: 'moved',
    actor,
    detail: {
      repeated: true,
      column_id: { from: card.column_id, to: column.id },
      due_date: { from: card.due_date, to: dueDate },
    },
  });
  return data as BoardCardRow;
}
