// The reads behind /admin/goals. Server-only: takes a service-role client,
// so nothing here may be imported from an island.
//
// Three shapes, one per page. The index needs every goal plus enough of the
// cards and KPIs to draw a rollup on each card. A goal page needs one goal,
// its parent, its children, and everything hanging off all of them. All Tasks
// needs the open cards from the boards that opted in, plus the last few weeks
// of finished ones.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BoardCardRow,
  BoardColumnRow,
  BoardRow,
  GoalKpiRow,
  GoalRow,
} from '@/lib/db';
import { loadAllColumns, loadBoards } from '@/lib/boards/store';
import { type PeopleNames } from '@/lib/sops/names';
import { getPeopleNames } from '@/lib/sops/people';
import { todayEastern } from '@/lib/shift-notes/validate';

/** A goals page is a page, not a database; past this it needs paging. */
const GOAL_LIMIT = 500;
const CARD_LIMIT = 2000;

/** Every email a set of goals and cards mentions, by name. */
async function peopleFor(
  goals: Pick<GoalRow, 'owner_email' | 'created_by' | 'completed_by'>[],
  cards: Pick<BoardCardRow, 'owner_email' | 'created_by' | 'completed_by'>[]
): Promise<PeopleNames> {
  return getPeopleNames([
    ...goals.flatMap((goal) => [goal.owner_email ?? '', goal.created_by ?? '', goal.completed_by ?? '']),
    ...cards.flatMap((card) => [card.owner_email ?? '', card.created_by, card.completed_by ?? '']),
  ]);
}

export interface GoalsIndexData {
  goals: GoalRow[];
  kpis: GoalKpiRow[];
  cards: BoardCardRow[];
  columns: BoardColumnRow[];
  boards: BoardRow[];
  people: PeopleNames;
  today: string;
}

/**
 * The index. Every goal, every KPI, and every card that is filed under one —
 * the cards are what the progress bars count, and loading them per goal would
 * be one query per card on the page.
 */
export async function loadGoalsIndex(db: SupabaseClient): Promise<GoalsIndexData> {
  const [goalsResult, kpisResult, cardsResult, columns, boards] = await Promise.all([
    db
      .from('goals')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(GOAL_LIMIT),
    db.from('goal_kpis').select('*').order('sort_order', { ascending: true }),
    db.from('board_cards').select('*').not('goal_id', 'is', null).limit(CARD_LIMIT),
    loadAllColumns(db),
    loadBoards(db),
  ]);

  if (goalsResult.error) throw new Error(goalsResult.error.message);
  if (kpisResult.error) throw new Error(kpisResult.error.message);
  if (cardsResult.error) throw new Error(cardsResult.error.message);

  const goals = (goalsResult.data ?? []) as GoalRow[];
  const cards = (cardsResult.data ?? []) as BoardCardRow[];

  return {
    goals,
    kpis: (kpisResult.data ?? []) as GoalKpiRow[],
    cards,
    columns,
    boards,
    people: await peopleFor(goals, cards),
    today: todayEastern(),
  };
}

export interface GoalPageData {
  goal: GoalRow;
  parent: GoalRow | null;
  children: GoalRow[];
  kpis: GoalKpiRow[];
  /** This goal's cards and its children's — what the rollup counts. */
  cards: BoardCardRow[];
  columns: BoardColumnRow[];
  boards: BoardRow[];
  /** Every top-level goal, for the parent picker and the card goal picker. */
  goals: GoalRow[];
  people: PeopleNames;
  today: string;
}

/** One goal page, or null when the id names nothing. */
export async function loadGoalPage(db: SupabaseClient, id: string): Promise<GoalPageData | null> {
  const { data, error } = await db.from('goals').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  const goal = (data as GoalRow) ?? null;
  if (!goal) return null;

  const [allGoalsResult, columns, boards] = await Promise.all([
    db
      .from('goals')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(GOAL_LIMIT),
    loadAllColumns(db),
    loadBoards(db),
  ]);
  if (allGoalsResult.error) throw new Error(allGoalsResult.error.message);

  const goals = (allGoalsResult.data ?? []) as GoalRow[];
  const children = goals.filter((row) => row.parent_id === goal.id);
  const parent = goal.parent_id ? (goals.find((row) => row.id === goal.parent_id) ?? null) : null;

  // The goal and everything under it: a parent's page shows its children's
  // KPIs and tasks, because that is what "rolls up" means.
  const family = [goal.id, ...children.map((child) => child.id)];

  const [kpisResult, cardsResult] = await Promise.all([
    db
      .from('goal_kpis')
      .select('*')
      .in('goal_id', family)
      .order('sort_order', { ascending: true }),
    db
      .from('board_cards')
      .select('*')
      .in('goal_id', family)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(CARD_LIMIT),
  ]);
  if (kpisResult.error) throw new Error(kpisResult.error.message);
  if (cardsResult.error) throw new Error(cardsResult.error.message);

  const cards = (cardsResult.data ?? []) as BoardCardRow[];

  return {
    goal,
    parent,
    children,
    kpis: (kpisResult.data ?? []) as GoalKpiRow[],
    cards,
    columns,
    boards,
    goals,
    people: await peopleFor([goal, ...children, ...(parent ? [parent] : [])], cards),
    today: todayEastern(),
  };
}

export interface AllTasksData {
  cards: BoardCardRow[];
  goals: GoalRow[];
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
export async function loadAllTasks(
  db: SupabaseClient,
  sinceYmd: string
): Promise<AllTasksData> {
  const [boards, columns, goalsResult] = await Promise.all([
    loadBoards(db),
    loadAllColumns(db),
    db
      .from('goals')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(GOAL_LIMIT),
  ]);
  if (goalsResult.error) throw new Error(goalsResult.error.message);

  const boardIds = boards.filter((board) => board.include_in_all_tasks).map((board) => board.id);
  if (boardIds.length === 0) {
    return {
      cards: [],
      goals: (goalsResult.data ?? []) as GoalRow[],
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
  const goals = (goalsResult.data ?? []) as GoalRow[];

  return {
    cards,
    goals,
    boards,
    columns,
    people: await peopleFor(goals, cards),
    today: todayEastern(),
  };
}
