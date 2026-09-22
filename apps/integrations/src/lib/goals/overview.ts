// The goals overview (/admin/boards/all-goals): every goal, where it stands,
// and the board that serves it. Pure and client-safe — the API hands over
// rows and the island runs this, so the filters change without a round trip.
//
// The page answers one question a founder asks on a Monday: which goals need
// a look? So within each status the order is pace first — overdue, then
// behind, then on track, then ahead — and only then the target date. The
// two progress reads (tasks and KPIs) come straight from goalRollup and are
// never averaged into one number; see lib/goals/progress.

import type { BoardCardRow, BoardColumnRow, BoardRow, GoalKpiRow, GoalRow } from '@/lib/db';
import { type GoalRollup, goalRollup, type PaceState } from './progress';
import type { GoalStatusValue } from './types';

export interface GoalsOverviewInput {
  goals: GoalRow[];
  kpis: GoalKpiRow[];
  boards: BoardRow[];
  columns: Pick<BoardColumnRow, 'id' | 'kind'>[];
  cards: Pick<BoardCardRow, 'column_id' | 'goal_id'>[];
}

export interface GoalOverviewRow {
  goal: GoalRow;
  /** The board that serves it — a live one over an archived one — or null. */
  board: BoardRow | null;
  /** The goal's own KPIs, in writing order. */
  kpis: GoalKpiRow[];
  rollup: GoalRollup;
}

export interface GoalStatusGroup {
  status: GoalStatusValue;
  rows: GoalOverviewRow[];
}

/** What needs a look first. */
const PACE_RANK: Record<PaceState, number> = {
  overdue: 0,
  behind: 1,
  on_track: 2,
  ahead: 3,
  none: 4,
  done: 5,
};

/** Every goal as a row, in no particular order; groupByStatus sorts. */
export function buildGoalRows(input: GoalsOverviewInput, today: string): GoalOverviewRow[] {
  const columnsById = new Map(input.columns.map((column) => [column.id, column]));

  const childrenOf = new Map<string, GoalRow[]>();
  for (const goal of input.goals) {
    if (!goal.parent_id) continue;
    const list = childrenOf.get(goal.parent_id) ?? [];
    list.push(goal);
    childrenOf.set(goal.parent_id, list);
  }

  // One board per goal, the live one when both a live and an archived board
  // point at it. Two live boards on one goal is a mistake the picker prevents;
  // if it happens anyway the first in display order wins.
  const boardByGoal = new Map<string, BoardRow>();
  for (const board of input.boards) {
    if (!board.goal_id) continue;
    const current = boardByGoal.get(board.goal_id);
    if (!current || (current.archived && !board.archived)) boardByGoal.set(board.goal_id, board);
  }

  return input.goals.map((goal) => ({
    goal,
    board: boardByGoal.get(goal.id) ?? null,
    kpis: input.kpis.filter((kpi) => kpi.goal_id === goal.id),
    rollup: goalRollup(
      goal,
      childrenOf.get(goal.id) ?? [],
      input.cards,
      input.kpis,
      columnsById,
      today
    ),
  }));
}

function compareOpen(a: GoalOverviewRow, b: GoalOverviewRow): number {
  const pace = PACE_RANK[a.rollup.pace] - PACE_RANK[b.rollup.pace];
  if (pace !== 0) return pace;
  // A dated goal ahead of an undated one; the nearer date first.
  const aDate = a.goal.target_date ?? '9999-99-99';
  const bDate = b.goal.target_date ?? '9999-99-99';
  if (aDate !== bDate) return aDate < bDate ? -1 : 1;
  return a.goal.sort_order - b.goal.sort_order || a.goal.title.localeCompare(b.goal.title);
}

/** Closed goals read newest first: what just got finished is the news. */
function compareClosed(a: GoalOverviewRow, b: GoalOverviewRow): number {
  const aWhen = a.goal.completed_at ?? a.goal.updated_at;
  const bWhen = b.goal.completed_at ?? b.goal.updated_at;
  if (aWhen !== bWhen) return aWhen > bWhen ? -1 : 1;
  return a.goal.title.localeCompare(b.goal.title);
}

/**
 * The page's order: what is being worked on, then what is waiting, then what
 * is finished — well, then otherwise.
 */
export const OVERVIEW_STATUS_ORDER: readonly GoalStatusValue[] = [
  'active',
  'planned',
  'completed',
  'dropped',
];

/**
 * The rows under each status, in OVERVIEW_STATUS_ORDER. Empty statuses are
 * left out — a heading over nothing says nothing.
 */
export function groupByStatus(rows: GoalOverviewRow[]): GoalStatusGroup[] {
  return OVERVIEW_STATUS_ORDER.map((status) => ({
    status,
    rows: rows
      .filter((row) => row.goal.status === status)
      .sort(status === 'completed' || status === 'dropped' ? compareClosed : compareOpen),
  })).filter((group) => group.rows.length > 0);
}

export interface GoalsOverviewSummary {
  byStatus: Record<GoalStatusValue, number>;
  /** Open goals past their target date. */
  overdue: number;
  /** Open goals behind pace (not counting the overdue ones). */
  behind: number;
  /** Across the open goals only: KPIs met over KPIs defined. */
  kpisMet: number;
  kpisTotal: number;
}

/** The strip at the top: the counts a founder wants before reading any row. */
export function summarize(rows: GoalOverviewRow[]): GoalsOverviewSummary {
  const summary: GoalsOverviewSummary = {
    byStatus: { planned: 0, active: 0, completed: 0, dropped: 0 },
    overdue: 0,
    behind: 0,
    kpisMet: 0,
    kpisTotal: 0,
  };
  for (const row of rows) {
    summary.byStatus[row.goal.status] += 1;
    if (row.goal.status !== 'planned' && row.goal.status !== 'active') continue;
    if (row.rollup.pace === 'overdue') summary.overdue += 1;
    if (row.rollup.pace === 'behind') summary.behind += 1;
    summary.kpisMet += row.rollup.kpis.met;
    summary.kpisTotal += row.rollup.kpis.total;
  }
  return summary;
}

export interface GoalFilters {
  /** An owner email, or 'all'. 'nobody' is the goals with no owner. */
  owner: string;
  /** An area, or 'all'. */
  area: string;
}

export const NO_OWNER = 'nobody';

export function filterRows(rows: GoalOverviewRow[], filters: GoalFilters): GoalOverviewRow[] {
  return rows.filter((row) => {
    if (filters.owner !== 'all') {
      const owner = row.goal.owner_email ?? NO_OWNER;
      if (owner !== filters.owner) return false;
    }
    if (filters.area !== 'all' && row.goal.area !== filters.area) return false;
    return true;
  });
}
