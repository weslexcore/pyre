// How a goal is doing: the tasks under it, the KPIs on it, and whether it is
// keeping pace with its target date. Pure and client-safe.
//
// Two numbers that deliberately never merge. Task progress is output — twelve
// things were written down and eight are done. KPI progress is outcome — the
// staff have run three of the four consecutive weeks. A goal can be 100% on
// tasks and nowhere near met, which is exactly the case the Trello board
// could not show, so nothing here ever averages the two into one bar.

import { isFinishedKind } from '@/lib/boards/types';
import { daysBetween, elapsedFraction } from '@/lib/campaigns/goals';
import type { BoardCardRow, BoardColumnRow, GoalKpiRow, GoalRow } from '@/lib/db';
import { goalKpiSummary, type KpiSummary } from './kpis';

export interface TaskProgress {
  total: number;
  /** Landed in a `done` column. */
  done: number;
  /** Landed in a `dropped` column — finished, but not an achievement. */
  dropped: number;
  open: number;
  /** Share of the tasks that finished well, 0–100. */
  pct: number;
}

/** Tally the cards filed under a goal by the kind of column they sit in. */
export function taskProgress(
  cards: Pick<BoardCardRow, 'column_id'>[],
  columnsById: Map<string, Pick<BoardColumnRow, 'kind'>>
): TaskProgress {
  let done = 0;
  let dropped = 0;
  for (const card of cards) {
    const kind = columnsById.get(card.column_id)?.kind;
    if (kind === 'done') done += 1;
    else if (kind === 'dropped') dropped += 1;
  }
  const total = cards.length;
  const open = total - done - dropped;
  // Dropped cards stay in the denominator: abandoning half the plan is not
  // the same as finishing it, and the bar should not reward it.
  return { total, done, dropped, open, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/**
 * Whole days from today to the target date — negative once it is past.
 * Null for a goal with no date, which is a goal with no pace.
 */
export function daysLeft(targetDate: string | null, today: string): number | null {
  if (!targetDate) return null;
  return daysBetween(today, targetDate);
}

export type PaceState =
  | 'none' // no target date, or nothing to measure against
  | 'ahead'
  | 'on_track'
  | 'behind'
  | 'overdue' // the date is past and the goal is still open
  | 'done'; // completed or dropped — pace stopped mattering

export const PACE_LABELS: Record<PaceState, string> = {
  none: 'No target',
  ahead: 'Ahead',
  on_track: 'On track',
  behind: 'Behind',
  overdue: 'Overdue',
  done: 'Closed',
};

// Same bands the campaign goals use: comfortably ahead, near enough, behind.
const AHEAD_RATIO = 1.1;
const ON_TRACK_RATIO = 0.75;

/**
 * Pace is progress measured against time spent, not against the finish line:
 * a goal that is 40% done a tenth of the way in is ahead, and the same goal
 * with a week left is behind. `progressPct` is whichever read the caller
 * cares about — task output on a goal with no KPIs, KPI outcome once it has
 * some (goalRollup picks; see below).
 *
 * A closed goal reports `done`, an open goal past its date reports `overdue`,
 * and both of those beat any pace band — an overdue goal at 95% is still
 * overdue, which is the thing worth saying out loud.
 */
export function paceState(
  goal: Pick<GoalRow, 'status' | 'started_at' | 'target_date'>,
  progressPct: number,
  today: string
): PaceState {
  if (goal.status === 'completed' || goal.status === 'dropped') return 'done';
  if (!goal.target_date) return 'none';

  const left = daysBetween(today, goal.target_date);
  if (left !== null && left < 0) return 'overdue';

  // Pace needs both ends of the run. Without a start there is only a
  // deadline, and a deadline alone says nothing about whether today is early.
  const startedYmd = goal.started_at ? goal.started_at.slice(0, 10) : '';
  const elapsed = elapsedFraction({ startsAt: startedYmd, endsAt: goal.target_date }, today);
  if (elapsed === null) return 'none';

  const expected = elapsed * 100;
  if (expected <= 0) return 'on_track';
  const ratio = progressPct / expected;
  if (ratio >= AHEAD_RATIO) return 'ahead';
  if (ratio >= ON_TRACK_RATIO) return 'on_track';
  return 'behind';
}

export interface GoalRollup {
  goalId: string;
  tasks: TaskProgress;
  kpis: KpiSummary;
  daysLeft: number | null;
  pace: PaceState;
  /** How many sub-goals rolled in (0 for a goal with no children). */
  childCount: number;
}

/**
 * Everything one goal card shows, with its children's work counted as its
 * own. A long-term goal ("staff run the space") is met through the midterm
 * goals under it, so its bar has to include their tasks and its KPI summary
 * their KPIs — otherwise a parent reads as 0/0 while three children are
 * halfway home.
 *
 * `cards` and `kpis` are the whole pools; this picks out the rows belonging
 * to the goal and its children rather than making every caller pre-filter.
 */
export function goalRollup(
  goal: Pick<GoalRow, 'id' | 'status' | 'started_at' | 'target_date'>,
  children: Pick<GoalRow, 'id'>[],
  cards: Pick<BoardCardRow, 'column_id' | 'goal_id'>[],
  kpis: Pick<
    GoalKpiRow,
    'goal_id' | 'direction' | 'start_value' | 'target_value' | 'current_value'
  >[],
  columnsById: Map<string, Pick<BoardColumnRow, 'kind'>>,
  today: string
): GoalRollup {
  const ids = new Set<string>([goal.id, ...children.map((c) => c.id)]);
  const mine = cards.filter((card) => card.goal_id && ids.has(card.goal_id));
  const myKpis = kpis.filter((kpi) => ids.has(kpi.goal_id));

  const tasks = taskProgress(mine, columnsById);
  const kpiSummary = goalKpiSummary(myKpis);

  // Pace follows the outcome when there is one to follow, and the output when
  // there is not: a goal with KPIs is judged on them, and a goal without is
  // judged on whether the work is getting done.
  const progressPct = kpiSummary.total > 0 ? kpiSummary.pct : tasks.pct;

  return {
    goalId: goal.id,
    tasks,
    kpis: kpiSummary,
    daysLeft: daysLeft(goal.target_date, today),
    pace: paceState(goal, progressPct, today),
    childCount: children.length,
  };
}

/** "in 12 days" / "3 days ago" / "today" — how the index labels a target. */
export function formatDaysLeft(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/** Only cards in an open column are still work. */
export function isCardOpen(
  card: Pick<BoardCardRow, 'column_id'>,
  columnsById: Map<string, Pick<BoardColumnRow, 'kind'>>
): boolean {
  const kind = columnsById.get(card.column_id)?.kind;
  return kind === undefined ? true : !isFinishedKind(kind);
}
