// The read behind All Tasks. Server-only: takes a service-role client, so
// nothing here may be imported from an island.
//
// Goals themselves are read through their boards (lib/boards/store), since
// the merge; what is left here is the one page that spans every board.

import type { SupabaseClient } from '@supabase/supabase-js';
import { type Assignable, listAssignable } from '@/lib/boards/people';
import { loadAllColumns, loadBoards } from '@/lib/boards/store';
import type { BoardCardRow, BoardColumnRow, BoardRow } from '@/lib/db';
import { todayEastern } from '@/lib/shift-notes/validate';
import type { PeopleNames } from '@/lib/sops/names';
import { getPeopleNames } from '@/lib/sops/people';

/** A page, not a database; past this it needs paging. */
const CARD_LIMIT = 2000;

/** Every email a set of cards mentions, by name. */
async function peopleFor(
  cards: Pick<BoardCardRow, 'owner_email' | 'created_by' | 'completed_by'>[]
): Promise<PeopleNames> {
  return getPeopleNames(
    cards.flatMap((card) => [card.owner_email ?? '', card.created_by, card.completed_by ?? ''])
  );
}

export interface AllTasksData {
  cards: BoardCardRow[];
  owners: Assignable[];
  boards: BoardRow[];
  columns: BoardColumnRow[];
  people: PeopleNames;
  today: string;
}

/**
 * All Tasks. `sinceYmd` bounds the done pile — everything still open is
 * always returned, however old, because an eight-week-old open task is
 * exactly the thing this page exists to surface.
 */
export async function loadAllTasks(db: SupabaseClient, sinceYmd: string): Promise<AllTasksData> {
  const [boards, columns] = await Promise.all([loadBoards(db), loadAllColumns(db)]);

  const boardIds = boards.filter((board) => board.include_in_all_tasks).map((board) => board.id);
  if (boardIds.length === 0) {
    return {
      cards: [],
      owners: await listAssignable(),
      boards,
      columns,
      people: {},
      today: todayEastern(),
    };
  }

  const { data, error } = await db
    .from('board_cards')
    .select('*')
    .in('board_id', boardIds)
    .or(`completed_at.is.null,completed_at.gte.${sinceYmd}T00:00:00Z`)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(CARD_LIMIT);
  if (error) throw new Error(error.message);

  const cards = (data ?? []) as BoardCardRow[];

  return {
    cards,
    owners: await listAssignable(),
    boards,
    columns,
    people: await peopleFor(cards),
    today: todayEastern(),
  };
}
