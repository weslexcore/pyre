// All Tasks (/admin/goals/tasks): the cross-goal page. Everything in flight,
// wherever it is filed, with the late and the imminent pulled to the top.
//
// This is the view that replaces Trello's Backlog and Focus lists, and the
// failure mode it has to avoid is being them: a wall of seventy cards that
// nobody reads. So the shape is deliberately narrow. Only boards that opted
// in appear (a lead pipeline is a queue, not a to-do list). Only open cards
// are listed — finished work is out of the way under "Recently done", by the
// week it landed in, which is the other question the founders ask each other
// and Trello could never answer. And the strips on top are the two questions
// that are actually urgent: what is late, and what is due this week.
//
// Pure and client-safe: the route hands over the rows, the island builds this.

import { addDays, weekStartOf } from '@pyre/schedule-core';
import type { BoardCardRow, BoardColumnRow, BoardRow, GoalRow } from '@/lib/db';
import { isFinishedKind } from '@/lib/boards/types';
import { type PeopleNames, personName } from '@/lib/sops/names';
import type { GroupBy } from './types';

export interface TaskGroup {
  /** Goal id, owner email, or board id — stable, for React keys and links. */
  key: string;
  label: string;
  /** The goal this group is, when grouping by goal — for the link through. */
  goalId?: string;
  boardSlug?: string;
  cards: BoardCardRow[];
}

export interface DoneWeek {
  /** Monday of the week, YYYY-MM-DD. */
  weekStart: string;
  /** "Week of 15 Sep". */
  label: string;
  cards: BoardCardRow[];
}

export interface AllTasks {
  /** Open, dated before today. */
  overdue: BoardCardRow[];
  /** Open, due today through Sunday of this week. */
  dueThisWeek: BoardCardRow[];
  groups: TaskGroup[];
  /** Open cards filed under no goal — the one-off chores. */
  unfiled: BoardCardRow[];
  /** Finished cards, newest week first. */
  recentlyDone: DoneWeek[];
}

export interface AllTasksOptions {
  /** Today in America/New_York, as the caller's clock reads it. */
  today: string;
  /** Whose tasks come first in the by-owner grouping. */
  viewerEmail: string;
  groupBy: GroupBy;
}

const UNASSIGNED = '__unassigned__';

/** Due date first (undated last), then hand order, then age. */
function byDueThenOrder(a: BoardCardRow, b: BoardCardRow): number {
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  }
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
}

// Spelled out rather than formatted, because Intl's short month drifts
// between runtimes ("Sep" in one, "Sept" in the next) and a heading should
// not depend on which Node built the page.
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "Week of 15 Sep" — how the done pile is headed. */
export function weekLabel(weekStart: string): string {
  const [year, month, day] = weekStart.split('-').map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return weekStart;
  return `Week of ${day} ${MONTHS[month - 1]}`;
}

export function buildAllTasks(
  cards: BoardCardRow[],
  goals: GoalRow[],
  boards: BoardRow[],
  columns: BoardColumnRow[],
  people: PeopleNames,
  options: AllTasksOptions
): AllTasks {
  const { today, viewerEmail, groupBy } = options;

  // Boards that said they belong here. Everything else — the rental pipeline,
  // any future queue — is invisible to this page by its own choice.
  const boardsById = new Map(boards.filter((b) => b.include_in_all_tasks).map((b) => [b.id, b]));
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const mine = cards.filter((card) => boardsById.has(card.board_id));

  const open: BoardCardRow[] = [];
  const done: BoardCardRow[] = [];
  for (const card of mine) {
    const kind = columnsById.get(card.column_id)?.kind;
    // A card whose column has gone missing is treated as open: work that
    // can't be proven finished should stay in front of somebody.
    if (kind !== undefined && isFinishedKind(kind)) done.push(card);
    else open.push(card);
  }
  open.sort(byDueThenOrder);

  // Today is not overdue. A task due this morning is due this morning.
  const overdue = open.filter((card) => card.due_date !== null && card.due_date < today);
  const weekEnd = addDays(weekStartOf(today), 6);
  const dueThisWeek = open.filter(
    (card) => card.due_date !== null && card.due_date >= today && card.due_date <= weekEnd
  );

  // The unfiled chores are their own section whatever the grouping, so the
  // "quick thing with no goal behind it" always has one obvious home.
  const unfiled = open.filter((card) => card.goal_id === null);
  const filed = open.filter((card) => card.goal_id !== null);

  const groups =
    groupBy === 'owner'
      ? groupByOwner(open, people, viewerEmail)
      : groupBy === 'board'
        ? groupByBoard(open, boardsById)
        : groupByGoal(filed, goals);

  return { overdue, dueThisWeek, groups, unfiled, recentlyDone: groupDone(done) };
}

/** Goals in index order, each with the cards filed under it. Empty goals are left out. */
function groupByGoal(cards: BoardCardRow[], goals: GoalRow[]): TaskGroup[] {
  const byGoal = new Map<string, BoardCardRow[]>();
  for (const card of cards) {
    if (!card.goal_id) continue;
    const group = byGoal.get(card.goal_id);
    if (group) group.push(card);
    else byGoal.set(card.goal_id, [card]);
  }

  const ordered = [...goals].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
  );

  const groups: TaskGroup[] = [];
  for (const goal of ordered) {
    const group = byGoal.get(goal.id);
    if (!group) continue;
    groups.push({ key: goal.id, label: goal.title, goalId: goal.id, cards: group });
    byGoal.delete(goal.id);
  }
  // A card filed under a goal that isn't in the pool (dropped from the page's
  // filter, say) still has to appear somewhere.
  for (const [goalId, group] of byGoal) {
    groups.push({ key: goalId, label: 'Another goal', goalId, cards: group });
  }
  return groups;
}

/**
 * People, with the viewer first and Unassigned last. First because this page
 * is read standing up before a shift ("what am I on"), and last because an
 * unowned task is a question for the group, not an assignment to nobody.
 */
function groupByOwner(
  cards: BoardCardRow[],
  people: PeopleNames,
  viewerEmail: string
): TaskGroup[] {
  const viewer = viewerEmail.trim().toLowerCase();
  const byOwner = new Map<string, BoardCardRow[]>();
  for (const card of cards) {
    const key = card.owner_email ?? UNASSIGNED;
    const group = byOwner.get(key);
    if (group) group.push(card);
    else byOwner.set(key, [card]);
  }

  return [...byOwner.entries()]
    .map(([key, group]) => ({
      key,
      label: key === UNASSIGNED ? 'Unassigned' : personName(key, people),
      cards: group,
    }))
    .sort((a, b) => {
      if (a.key === b.key) return 0;
      if (a.key === UNASSIGNED) return 1;
      if (b.key === UNASSIGNED) return -1;
      if (a.key === viewer) return -1;
      if (b.key === viewer) return 1;
      return a.label.localeCompare(b.label);
    });
}

function groupByBoard(cards: BoardCardRow[], boardsById: Map<string, BoardRow>): TaskGroup[] {
  const byBoard = new Map<string, BoardCardRow[]>();
  for (const card of cards) {
    const group = byBoard.get(card.board_id);
    if (group) group.push(card);
    else byBoard.set(card.board_id, [card]);
  }
  return [...byBoard.entries()]
    .map(([boardId, group]) => {
      const board = boardsById.get(boardId);
      return {
        key: boardId,
        label: board?.name ?? 'Another board',
        boardSlug: board?.slug,
        cards: group,
        sortOrder: board?.sort_order ?? 0,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map(({ sortOrder: _sortOrder, ...group }) => group);
}

/** Finished cards under the Monday of the week they landed in, newest first. */
function groupDone(cards: BoardCardRow[]): DoneWeek[] {
  const byWeek = new Map<string, BoardCardRow[]>();
  for (const card of cards) {
    // A card can be finished without a stamp only if it was moved before this
    // tool existed; fall back to when it was last touched.
    const landed = (card.completed_at ?? card.updated_at).slice(0, 10);
    const weekStart = weekStartOf(landed);
    const group = byWeek.get(weekStart);
    if (group) group.push(card);
    else byWeek.set(weekStart, [card]);
  }
  return [...byWeek.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([weekStart, group]) => ({
      weekStart,
      label: weekLabel(weekStart),
      cards: group.sort((a, b) =>
        (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at)
      ),
    }));
}
