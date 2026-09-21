// The rules a goal changes by: what a status flip does to the timestamps,
// and what a founder is shown before they call a goal met. Pure and
// client-safe — the route applies these and the dialog previews them, from
// the same code.

import { isFinishedKind } from '@/lib/boards/types';
import type { BoardCardRow, BoardColumnRow, GoalKpiRow, GoalRow } from '@/lib/db';
import { goalKpiSummary } from './kpis';
import type { GoalStatusValue } from './types';

/** The columns a status change is allowed to touch. */
export type GoalStatusPatch = Pick<
  GoalRow,
  'status' | 'started_at' | 'completed_at' | 'completed_by'
>;

/**
 * The patch that moves a goal to `next`, with the bookkeeping the constraints
 * insist on:
 *
 *  * completed always carries a timestamp and a name (goals_completed_has_
 *    timestamp, goals_completion_attributed), and leaving completed clears
 *    both — an un-completed goal with a completion date on it would be a lie
 *    the database would reject anyway.
 *  * started_at is stamped the first time a goal goes active and is never
 *    written again. A goal that goes active, stalls back to planned, and
 *    starts again has been running since the first day, and its pace should
 *    say so.
 *
 * Returns the whole set every time, including a no-op flip, so a caller can
 * apply it without asking whether anything changed.
 */
export function goalStatusPatch(
  goal: Pick<GoalRow, 'status' | 'started_at' | 'completed_at' | 'completed_by'>,
  next: GoalStatusValue,
  email: string,
  nowIso: string
): GoalStatusPatch {
  const completing = next === 'completed';
  return {
    status: next,
    started_at: goal.started_at ?? (next === 'active' ? nowIso : null),
    completed_at: completing ? (goal.completed_at ?? nowIso) : null,
    completed_by: completing ? (goal.completed_by ?? email) : null,
  };
}

export interface CompletionPreview {
  kpisMet: number;
  kpisTotal: number;
  /** Cards still sitting in an open column under this goal. */
  openCards: number;
  /** True when there is nothing outstanding — never a reason to auto-close. */
  clean: boolean;
}

/**
 * What the Mark completed dialog says before the button is pressed: how many
 * KPIs are met, and how much work is still open. None of it blocks the
 * decision — a goal whose KPIs are met with three tasks still open is a
 * perfectly good goal to close, and a goal at 12/12 tasks with a KPI short is
 * a perfectly good one to leave open. The point is that the person deciding
 * sees both numbers first, and writes down what they saw.
 */
export function completionPreview(
  kpis: Pick<GoalKpiRow, 'direction' | 'start_value' | 'target_value' | 'current_value'>[],
  cards: Pick<BoardCardRow, 'column_id'>[],
  columnsById: Map<string, Pick<BoardColumnRow, 'kind'>>
): CompletionPreview {
  const summary = goalKpiSummary(kpis);
  const openCards = cards.filter((card) => {
    const kind = columnsById.get(card.column_id)?.kind;
    return kind === undefined ? true : !isFinishedKind(kind);
  }).length;
  return {
    kpisMet: summary.met,
    kpisTotal: summary.total,
    openCards,
    clean: openCards === 0 && (summary.total === 0 || summary.allMet),
  };
}
