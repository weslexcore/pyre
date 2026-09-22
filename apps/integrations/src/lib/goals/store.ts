// The reads behind the two pages that span every board — All Tasks and the
// goals overview. Server-only: takes a service-role client, so nothing here
// may be imported from an island.
//
// A single goal is read through its board (lib/boards/store), since the
// merge; what lives here is what needs every goal at once.

import type { SupabaseClient } from '@supabase/supabase-js';
import { type Assignable, listAssignable } from '@/lib/boards/people';
import { loadAllColumns, loadBoards } from '@/lib/boards/store';
import type { BoardCardRow, BoardColumnRow, BoardRow, GoalKpiRow, GoalRow } from '@/lib/db';
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

/** Goals are a page, not a database; past this the overview needs paging. */
const GOAL_LIMIT = 500;

export interface GoalsOverviewData {
  goals: GoalRow[];
  kpis: GoalKpiRow[];
  boards: BoardRow[];
  columns: Pick<BoardColumnRow, 'id' | 'kind'>[];
  /** Every card filed under a goal — just enough to tally it by column kind. */
  cards: Pick<BoardCardRow, 'column_id' | 'goal_id'>[];
  people: PeopleNames;
  today: string;
}

/**
 * The goals overview: every goal (closed ones too — a finished goal is part
 * of where we stand), its KPIs, the boards that serve them, and the cards
 * under them slimmed to the two columns the task bar needs.
 */
export async function loadGoalsOverview(db: SupabaseClient): Promise<GoalsOverviewData> {
  const [goalsResult, kpisResult, boards, columns, cardsResult] = await Promise.all([
    db
      .from('goals')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(GOAL_LIMIT),
    db.from('goal_kpis').select('*').order('sort_order', { ascending: true }),
    loadBoards(db),
    loadAllColumns(db),
    db
      .from('board_cards')
      .select('column_id, goal_id')
      .not('goal_id', 'is', null)
      .limit(CARD_LIMIT),
  ]);
  if (goalsResult.error) throw new Error(goalsResult.error.message);
  if (kpisResult.error) throw new Error(kpisResult.error.message);
  if (cardsResult.error) throw new Error(cardsResult.error.message);

  const goals = (goalsResult.data ?? []) as GoalRow[];
  return {
    goals,
    kpis: (kpisResult.data ?? []) as GoalKpiRow[],
    boards,
    columns: columns.map((column) => ({ id: column.id, kind: column.kind })),
    cards: (cardsResult.data ?? []) as Pick<BoardCardRow, 'column_id' | 'goal_id'>[],
    people: await getPeopleNames(
      goals.flatMap((goal) => [goal.owner_email ?? '', goal.completed_by ?? ''])
    ),
    today: todayEastern(),
  };
}
