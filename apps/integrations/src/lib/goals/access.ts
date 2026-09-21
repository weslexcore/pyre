// The rules a goal changes by: what a status flip does to the timestamps,
// which goals may parent which, and what a founder is shown before they call
// a goal met. Pure and client-safe — the route applies these and the dialog
// previews them, from the same code.

import type { BoardCardRow, BoardColumnRow, GoalKpiRow, GoalRow } from '@/lib/db';
import { isFinishedKind } from '@/lib/boards/types';
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

/**
 * Whether `candidate` may be named as `childId`'s parent. Goals nest exactly
 * one level: a parent with a parent of its own would make a grandparent, and
 * three levels of goal is the org chart nobody asked for. A goal can't parent
 * itself either.
 */
export function canBeParent(
  candidate: Pick<GoalRow, 'id' | 'parent_id'>,
  childId: string | null
): boolean {
  if (candidate.parent_id !== null) return false;
  return childId === null || candidate.id !== childId;
}

/**
 * Whether `goal` may be given a parent — only if nothing is already filed
 * under it. The other half of the one-level rule: adopting a parent for a
 * goal that already has children would push those children to depth two.
 */
export function canAdoptParent(
  goal: Pick<GoalRow, 'id'>,
  goals: Pick<GoalRow, 'parent_id'>[]
): boolean {
  return !goals.some((other) => other.parent_id === goal.id);
}

/** The goals the parent picker may offer for `childId` (null for a new goal). */
export function parentOptions<T extends Pick<GoalRow, 'id' | 'parent_id'>>(
  goals: T[],
  childId: string | null
): T[] {
  return goals.filter((goal) => canBeParent(goal, childId));
}

export interface CompletionPreview {
  kpisMet: number;
  kpisTotal: number;
  /** Cards still sitting in an open column, this goal's and its children's. */
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
