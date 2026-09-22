// The reads behind /admin/boards. Server-only: takes a service-role client,
// so nothing here may be imported from an island.
//
// A board page is one bundle — the board, its columns, its fields, its cards,
// the goal it serves and that goal's KPIs — because every one of them is
// needed to render a single column view, and six round trips to draw one
// page is five too many. The index is one bundle too: the boards, their
// goals, those goals' KPIs, and a per-board card tally, which is what a
// board card on the landing page draws its meters from.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PageAccess } from '@/components/admin/adminTools';
import type {
  BoardCardRow,
  BoardColumnRow,
  BoardFieldRow,
  BoardRow,
  BoardSectionRow,
  GoalKpiRow,
  GoalRow,
} from '@/lib/db';
import { todayEastern } from '@/lib/shift-notes/validate';
import type { PeopleNames } from '@/lib/sops/names';
import { getPeopleNames } from '@/lib/sops/people';
import { canManageBoards, canViewBoard } from './access';
import { type Assignable, listAssignable } from './people';
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

/** Every index heading, in position order. */
export async function loadSections(db: SupabaseClient): Promise<BoardSectionRow[]> {
  const { data, error } = await db
    .from('board_sections')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoardSectionRow[];
}

export async function loadSection(db: SupabaseClient, id: string): Promise<BoardSectionRow | null> {
  const { data, error } = await db.from('board_sections').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BoardSectionRow) ?? null;
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

export async function loadGoal(db: SupabaseClient, id: string): Promise<GoalRow | null> {
  const { data, error } = await db.from('goals').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as GoalRow) ?? null;
}

export async function goalExists(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db.from('goals').select('id').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

/** The KPIs on one goal, in writing order. */
export async function loadKpis(db: SupabaseClient, goalId: string): Promise<GoalKpiRow[]> {
  const { data, error } = await db
    .from('goal_kpis')
    .select('*')
    .eq('goal_id', goalId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as GoalKpiRow[];
}

export interface BoardBundle {
  board: BoardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  cards: BoardCardRow[];
  /** The goal this board serves, with its KPIs — null for a plain list. */
  goal: GoalRow | null;
  kpis: GoalKpiRow[];
}

/** Everything one board page renders, or null when the slug names nothing. */
export async function loadBoardBundle(
  db: SupabaseClient,
  slug: string
): Promise<BoardBundle | null> {
  const board = await loadBoardBySlug(db, slug);
  if (!board) return null;

  const [columns, fieldsResult, cardsResult, goal, kpis] = await Promise.all([
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
    board.goal_id ? loadGoal(db, board.goal_id) : Promise.resolve(null),
    board.goal_id ? loadKpis(db, board.goal_id) : Promise.resolve([] as GoalKpiRow[]),
  ]);

  if (fieldsResult.error) throw new Error(fieldsResult.error.message);
  if (cardsResult.error) throw new Error(cardsResult.error.message);

  return {
    board,
    columns,
    fields: (fieldsResult.data ?? []) as BoardFieldRow[],
    cards: (cardsResult.data ?? []) as BoardCardRow[],
    goal,
    kpis,
  };
}

/** How many cards a board holds and how many are still open. */
export interface BoardTally {
  board_id: string;
  open: number;
  total: number;
}

export interface BoardsIndexData {
  boards: BoardRow[];
  /** Every heading, in order — empty ones too, for whoever may arrange them. */
  sections: BoardSectionRow[];
  /** The goals the listed boards serve. */
  goals: GoalRow[];
  /** Those goals' KPIs. */
  kpis: GoalKpiRow[];
  tallies: BoardTally[];
}

/**
 * The landing page, for a set of boards the caller has already filtered to
 * what this viewer may see — so the goals and tallies that come back never
 * describe a board the viewer was not given.
 */
export async function loadBoardsIndex(
  db: SupabaseClient,
  boards: BoardRow[]
): Promise<BoardsIndexData> {
  const sections = await loadSections(db);
  if (boards.length === 0) return { boards, sections, goals: [], kpis: [], tallies: [] };

  const goalIds = [...new Set(boards.flatMap((board) => (board.goal_id ? [board.goal_id] : [])))];
  const [goalsResult, kpisResult, cardsResult] = await Promise.all([
    goalIds.length > 0
      ? db.from('goals').select('*').in('id', goalIds)
      : Promise.resolve({ data: [] as GoalRow[], error: null }),
    goalIds.length > 0
      ? db
          .from('goal_kpis')
          .select('*')
          .in('goal_id', goalIds)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] as GoalKpiRow[], error: null }),
    db
      .from('board_cards')
      .select('board_id, completed_at')
      .in(
        'board_id',
        boards.map((board) => board.id)
      )
      .limit(BOARD_LIMITS.cardsPerBoard * boards.length),
  ]);
  if (goalsResult.error) throw new Error(goalsResult.error.message);
  if (kpisResult.error) throw new Error(kpisResult.error.message);
  if (cardsResult.error) throw new Error(cardsResult.error.message);

  const tallies = new Map(boards.map((board) => [board.id, { open: 0, total: 0 }]));
  for (const row of (cardsResult.data ?? []) as Pick<BoardCardRow, 'board_id' | 'completed_at'>[]) {
    const tally = tallies.get(row.board_id);
    if (!tally) continue;
    tally.total += 1;
    if (row.completed_at === null) tally.open += 1;
  }

  return {
    boards,
    sections,
    goals: (goalsResult.data ?? []) as GoalRow[],
    kpis: (kpisResult.data ?? []) as GoalKpiRow[],
    tallies: [...tallies.entries()].map(([board_id, tally]) => ({ board_id, ...tally })),
  };
}

/** The boards serving one goal — normally one, occasionally none. */
export async function boardsForGoal(db: SupabaseClient, goalId: string): Promise<BoardRow[]> {
  const { data, error } = await db
    .from('boards')
    .select('*')
    .eq('goal_id', goalId)
    .order('archived', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoardRow[];
}

/**
 * Open goals no board serves yet — what the "use an existing goal" picker
 * offers, so two boards do not end up sharing one by accident.
 */
export async function unattachedGoals(db: SupabaseClient): Promise<GoalRow[]> {
  const [goalsResult, boardsResult] = await Promise.all([
    db
      .from('goals')
      .select('*')
      .in('status', ['planned', 'active'])
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    db.from('boards').select('goal_id').not('goal_id', 'is', null),
  ]);
  if (goalsResult.error) throw new Error(goalsResult.error.message);
  if (boardsResult.error) throw new Error(boardsResult.error.message);
  const taken = new Set(
    ((boardsResult.data ?? []) as { goal_id: string }[]).map((row) => row.goal_id)
  );
  return ((goalsResult.data ?? []) as GoalRow[]).filter((goal) => !taken.has(goal.id));
}

/**
 * Point a board at a goal (or at none) and re-file its cards to match. The
 * cards follow the board because a card's goal *is* its board's goal — a
 * board whose goal changed with forty cards still counting toward the old
 * one would make the old goal's task bar a lie.
 */
export async function attachGoalToBoard(
  db: SupabaseClient,
  board: Pick<BoardRow, 'id'>,
  goalId: string | null,
  email: string
): Promise<void> {
  const { error } = await db
    .from('boards')
    .update({ goal_id: goalId, updated_by: email })
    .eq('id', board.id);
  if (error) throw new Error(error.message);

  const { error: cardsError } = await db
    .from('board_cards')
    .update({ goal_id: goalId })
    .eq('board_id', board.id);
  if (cardsError) throw new Error(cardsError.message);
}

/**
 * Whether this viewer may read or work a goal: the whole tool, or any board
 * they hold that serves it. A single-board grantee reaches exactly the goal
 * on their board, and a goal no board serves is the tool's alone.
 */
export async function canReachGoal(
  db: SupabaseClient,
  access: PageAccess,
  goalId: string
): Promise<boolean> {
  if (canManageBoards(access)) return true;
  const boards = await boardsForGoal(db, goalId);
  return boards.some((board) => canViewBoard(access, board.slug));
}

/** A page, not a database; past this the calendar needs a narrower window. */
const CALENDAR_CARD_LIMIT = 2000;
const CALENDAR_GOAL_LIMIT = 500;

export interface BoardsCalendarData {
  boards: BoardRow[];
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  cards: BoardCardRow[];
  goals: GoalRow[];
  people: PeopleNames;
  /** Everyone a card can be reassigned to — the drawer opens here. */
  owners: Assignable[];
  today: string;
}

/**
 * The cross-board calendar: everything dated in one window, on the boards the
 * caller has already filtered to what this viewer may see.
 *
 * The window is applied to due dates in SQL and to the dated fields in
 * buildCalendar rather than here. Postgres could filter a known jsonb key —
 * `properties->>requested_date` is indexable and the keys match
 * ^[a-z][a-z0-9_]+$, so the path is safe to build — but the set of keys
 * differs per board and grows every time somebody adds a field, so the query
 * would be assembled from configuration and would need an index per key to be
 * worth anything. At this scale (a handful of boards, a thousand cards each
 * at most) one bounded read and a filter in memory is the simpler true thing.
 * If it ever stops being: a generated `date` column per dated field, or a
 * board_card_dates projection, is the move.
 */
export async function loadBoardsCalendar(
  db: SupabaseClient,
  boards: BoardRow[],
  start: string,
  end: string
): Promise<BoardsCalendarData> {
  const live = boards.filter((board) => !board.archived);
  const boardIds = live.map((board) => board.id);
  if (boardIds.length === 0) {
    return {
      boards: live,
      columns: [],
      fields: [],
      cards: [],
      goals: [],
      people: {},
      owners: await listAssignable(),
      today: todayEastern(),
    };
  }

  const [columns, fieldsResult, cardsResult, goalsResult] = await Promise.all([
    loadAllColumns(db),
    db
      .from('board_fields')
      .select('*')
      .in('board_id', boardIds)
      .eq('archived', false)
      .order('sort_order', { ascending: true }),
    db
      .from('board_cards')
      .select('*')
      .in('board_id', boardIds)
      .order('created_at', { ascending: true })
      .limit(CALENDAR_CARD_LIMIT),
    db
      .from('goals')
      .select('*')
      .not('target_date', 'is', null)
      .gte('target_date', start)
      .lte('target_date', end)
      .order('target_date', { ascending: true })
      .limit(CALENDAR_GOAL_LIMIT),
  ]);

  if (fieldsResult.error) throw new Error(fieldsResult.error.message);
  if (cardsResult.error) throw new Error(cardsResult.error.message);
  if (goalsResult.error) throw new Error(goalsResult.error.message);

  const cards = (cardsResult.data ?? []) as BoardCardRow[];

  return {
    boards: live,
    columns: columns.filter((column) => boardIds.includes(column.board_id)),
    fields: (fieldsResult.data ?? []) as BoardFieldRow[],
    cards,
    goals: (goalsResult.data ?? []) as GoalRow[],
    people: await getPeopleNames(
      cards.flatMap((card) => [card.owner_email ?? '', card.created_by])
    ),
    owners: await listAssignable(),
    today: todayEastern(),
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
