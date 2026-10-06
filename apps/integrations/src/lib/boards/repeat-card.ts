// Filing the next copy of a repeating card. Server-only.
//
// Called by the routes once a card has been finished (moved into a done or
// dropped column, by hand or by its checklist). The rule moves to the new
// card: the finished one stops repeating first — conditionally, so two saves
// racing to finish the same card file one copy between them — and the copy
// lands in the board's first open column, due on the next date, on the same
// people, with the same notes and plain answers. Files, linked cards, and
// checklist progress belong to the occurrence that did the work, so the copy
// starts without them (a checklist starts again from its field's default).

import { todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BoardCardRow, BoardFieldValue } from '@/lib/db';
import { defaultColumn, nextSortOrder } from './cards';
import { loadBoardFields } from './create-card';
import { logBoardEvent } from './events';
import { nextRepeatDate, repeatRuleOf } from './recurrence';
import { loadColumns } from './store';
import { kindIsChecklist, kindIsSettled } from './types';

export interface RepeatResult {
  /** The finished card, no longer repeating. */
  finished: BoardCardRow;
  /** The next occurrence. */
  next: BoardCardRow;
}

/**
 * The next occurrence of `card`, if it repeats and is finished. Null when
 * there is nothing to file, or another save already filed it.
 */
export async function fileNextRepeat(
  db: SupabaseClient,
  card: BoardCardRow,
  actor: string,
  today: string = todayEastern()
): Promise<RepeatResult | null> {
  const rule = repeatRuleOf(card);
  if (!rule || card.completed_at === null) return null;

  const columns = await loadColumns(db, card.board_id);
  const column = defaultColumn(columns);
  // A board whose only live columns are finished ones has nowhere to put it.
  if (column?.kind !== 'open') return null;

  const { data: cleared, error: clearError } = await db
    .from('board_cards')
    .update({ repeat_every: null, repeat_unit: null, updated_by: actor })
    .eq('id', card.id)
    .not('repeat_unit', 'is', null)
    .select('*');
  if (clearError) {
    console.warn('[boards] could not stop the finished card repeating:', clearError.message);
    return null;
  }
  const finished = ((cleared ?? []) as BoardCardRow[])[0];
  if (!finished) return null;

  const fields = await loadBoardFields(db, card.board_id);
  const carried = new Set(
    fields
      .filter((field) => !kindIsSettled(field.kind) && !kindIsChecklist(field.kind))
      .map((field) => field.key)
  );
  const properties: Record<string, BoardFieldValue> = {};
  for (const [key, value] of Object.entries(card.properties)) {
    if (carried.has(key)) properties[key] = value;
  }

  const { data: siblings } = await db
    .from('board_cards')
    .select('column_id, sort_order')
    .eq('board_id', card.board_id);

  const { data, error } = await db
    .from('board_cards')
    .insert({
      board_id: card.board_id,
      column_id: column.id,
      goal_id: card.goal_id,
      title: card.title,
      notes_md: card.notes_md,
      // On whoever owns the column it lands in, if anyone does; otherwise
      // on the people who had the last one.
      assignee_emails: column.assignee_emails?.length
        ? column.assignee_emails
        : card.assignee_emails,
      due_date: nextRepeatDate(card.due_date, rule, today),
      repeat_every: rule.every,
      repeat_unit: rule.unit,
      area: card.area,
      properties,
      sort_order: nextSortOrder(
        (siblings ?? []) as Pick<BoardCardRow, 'column_id' | 'sort_order'>[],
        column.id
      ),
      created_by: actor,
    })
    .select('*')
    .single();
  if (error) {
    // Put the rule back, so the next finish (or a retry) tries again rather
    // than the series quietly ending here.
    await db
      .from('board_cards')
      .update({ repeat_every: rule.every, repeat_unit: rule.unit })
      .eq('id', card.id);
    console.warn('[boards] could not file the next repeat:', error.message);
    return null;
  }

  const next = data as BoardCardRow;
  await logBoardEvent(db, {
    cardId: next.id,
    action: 'created',
    actor,
    detail: { repeatOf: card.id },
  });
  await logBoardEvent(db, {
    cardId: card.id,
    action: 'updated',
    actor,
    detail: {
      repeat_every: { from: rule.every, to: null },
      repeat_unit: { from: rule.unit, to: null },
    },
  });
  return { finished, next };
}
