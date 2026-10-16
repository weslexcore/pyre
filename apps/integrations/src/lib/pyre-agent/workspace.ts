// What Pyre Agent reads of the goals and boards, on behalf of the person in
// the conversation: the goals with where each stands (task and KPI progress,
// pace against the target date), one board's columns and cards, and a
// search across the cards. pyre-agents asks for these through
// /api/agent/pyre; every read here is filtered by the asker's own access
// (lib/boards/access), resolved fresh from their email, so the agent never
// describes a board they could not open. Shapes are compact and flat — the
// model reads them, not a page — with dashboard links it can cite.
// Server-only.

import { todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PageAccess } from '@/components/admin/adminTools';
import { canManageBoards, canViewBoard, visibleBoards } from '@/lib/boards/access';
import { cardMatches, searchTerms } from '@/lib/boards/search';
import { loadAllColumns, loadBoardBundle, loadBoards } from '@/lib/boards/store';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow, BoardRow, GoalKpiRow } from '@/lib/db';
import { buildGoalRows } from '@/lib/goals/overview';
import { PACE_LABELS } from '@/lib/goals/progress';
import { loadGoalsOverview } from '@/lib/goals/store';
import { goalOverviewHref } from '@/lib/goals/types';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { getPeopleNames } from '@/lib/sops/people';
import { cardHref } from '@/lib/suggestions/types';

/** Cards one search or board read returns at most. */
const MAX_CARDS = 80;
/** Card notes are cut to this in a list; read_board's full card keeps more. */
const NOTES_PREVIEW = 280;

export function boardHref(slug: string): string {
  return `/admin/boards/${slug}`;
}

function kpiView(kpi: GoalKpiRow) {
  return {
    id: kpi.id,
    name: kpi.name,
    unit: kpi.unit,
    direction: kpi.direction === 'at_least' ? 'at least' : 'at most',
    start: kpi.start_value,
    target: kpi.target_value,
    current: kpi.current_value,
    measuredAt: kpi.measured_at,
  };
}

/**
 * Every goal the asker can see — all of them with the whole Boards tool,
 * otherwise the goals of the boards they were given — with its board, KPIs,
 * task tally and pace, open goals first. Plus the boards themselves.
 */
export async function goalsForAgent(db: SupabaseClient, access: PageAccess) {
  const data = await loadGoalsOverview(db);
  const boards = visibleBoards(access, data.boards).filter((b) => !b.archived);
  const manager = canManageBoards(access);
  const goalIds = new Set(boards.flatMap((b) => (b.goal_id ? [b.goal_id] : [])));
  const goals = manager ? data.goals : data.goals.filter((g) => goalIds.has(g.id));

  const rows = buildGoalRows({ ...data, goals }, data.today);
  const rank = { active: 0, planned: 1, completed: 2, dropped: 3 } as const;
  rows.sort((a, b) => rank[a.goal.status] - rank[b.goal.status]);

  const tallies = new Map<string, { open: number; total: number }>();
  const columnKind = new Map(data.columns.map((c) => [c.id, c.kind]));
  const { data: cardRows } =
    boards.length > 0
      ? await db
          .from('board_cards')
          .select('board_id, column_id')
          .in(
            'board_id',
            boards.map((b) => b.id)
          )
      : { data: [] };
  for (const card of (cardRows ?? []) as Pick<BoardCardRow, 'board_id' | 'column_id'>[]) {
    const tally = tallies.get(card.board_id) ?? { open: 0, total: 0 };
    tally.total += 1;
    if (columnKind.get(card.column_id) === 'open') tally.open += 1;
    tallies.set(card.board_id, tally);
  }

  return {
    today: data.today,
    canManageBoards: manager,
    goals: rows.map(({ goal, board, kpis, rollup }) => ({
      id: goal.id,
      title: goal.title,
      status: goal.status,
      owner: goal.owner_email ? personName(goal.owner_email, data.people) : null,
      area: goal.area,
      targetDate: goal.target_date,
      daysLeft: rollup.daysLeft,
      pace: PACE_LABELS[rollup.pace],
      tasks: {
        open: rollup.tasks.open,
        done: rollup.tasks.done,
        dropped: rollup.tasks.dropped,
        total: rollup.tasks.total,
        pctDone: Math.round(rollup.tasks.pct),
      },
      kpis: kpis.map(kpiView),
      kpiProgressPct: rollup.kpis.total > 0 ? Math.round(rollup.kpis.pct) : null,
      description: goal.description_md.slice(0, NOTES_PREVIEW),
      completionNote: goal.completion_note,
      board: board && boards.some((b) => b.id === board.id) ? board.slug : null,
      url:
        board && boards.some((b) => b.id === board.id)
          ? boardHref(board.slug)
          : goalOverviewHref(goal.id),
    })),
    boards: boards.map((b) => ({
      slug: b.slug,
      name: b.name,
      description: b.description,
      cardNoun: b.card_noun,
      goal: b.goal_id ? (data.goals.find((g) => g.id === b.goal_id)?.title ?? null) : null,
      openCards: tallies.get(b.id)?.open ?? 0,
      totalCards: tallies.get(b.id)?.total ?? 0,
      url: boardHref(b.slug),
    })),
  };
}

type CardColumn = Pick<BoardColumnRow, 'id' | 'key' | 'label' | 'kind'>;

function cardView(
  card: BoardCardRow,
  board: Pick<BoardRow, 'slug' | 'name'>,
  column: CardColumn | undefined,
  people: PeopleNames,
  today: string,
  notesLength = NOTES_PREVIEW
) {
  const open = column?.kind === 'open';
  return {
    id: card.id,
    title: card.title,
    board: board.slug,
    boardName: board.name,
    column: column?.label ?? null,
    columnKey: column?.key ?? null,
    state: column?.kind ?? 'open',
    assignees: card.assignee_emails.map((email) => ({ name: personName(email, people), email })),
    dueDate: card.due_date,
    overdue: open && card.due_date !== null && card.due_date < today,
    waitingOn: card.waiting_on,
    notes:
      card.notes_md.length > notesLength
        ? `${card.notes_md.slice(0, notesLength)}…`
        : card.notes_md,
    completedAt: card.completed_at,
    updatedAt: card.updated_at,
    url: cardHref(board.slug, card.id),
  };
}

/** One board as the agent reads it: its goal and KPIs, columns, and cards by column. */
export async function boardForAgent(db: SupabaseClient, access: PageAccess, slug: string) {
  if (!canViewBoard(access, slug)) return { error: `No board "${slug}" you can open` };
  const bundle = await loadBoardBundle(db, slug);
  if (!bundle) return { error: `No board "${slug}" you can open` };
  const today = todayEastern();
  const people = await getPeopleNames(bundle.cards.flatMap((c) => c.assignee_emails));
  const columns = bundle.columns.filter((c) => !c.archived);
  const byId = new Map(bundle.columns.map((c) => [c.id, c]));
  // Open work, and what finished in the last month; older history is noise here.
  const since = daysAgo(today, 30);
  const cards = bundle.cards.filter(
    (c) =>
      byId.get(c.column_id)?.kind === 'open' ||
      (c.completed_at ?? c.updated_at).slice(0, 10) >= since
  );
  return {
    board: {
      slug: bundle.board.slug,
      name: bundle.board.name,
      description: bundle.board.description,
      cardNoun: bundle.board.card_noun,
      archived: bundle.board.archived,
      url: boardHref(bundle.board.slug),
    },
    goal: bundle.goal
      ? {
          id: bundle.goal.id,
          title: bundle.goal.title,
          status: bundle.goal.status,
          targetDate: bundle.goal.target_date,
          kpis: bundle.kpis.map(kpiView),
        }
      : null,
    columns: columns.map((c) => ({ key: c.key, label: c.label, kind: c.kind })),
    fields: bundle.fields
      .filter((f: BoardFieldRow) => !f.archived)
      .map((f) => ({ key: f.key, label: f.label, kind: f.kind })),
    cards: cards
      .slice(0, MAX_CARDS * 2)
      .map((card) => cardView(card, bundle.board, byId.get(card.column_id), people, today)),
    note:
      cards.length < bundle.cards.length
        ? 'Cards finished more than 30 days ago are left out.'
        : undefined,
  };
}

function daysAgo(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export interface FindCardsInput {
  query?: string;
  board?: string;
  /** "me", an email, or part of a name. */
  assignee?: string;
  state?: 'open' | 'finished' | 'all';
  /** YYYY-MM-DD: only cards due on or before this date. */
  dueBy?: string;
  overdue?: boolean;
  limit?: number;
}

/** Cards across every board the asker can open, filtered; open ones by default. */
export async function findCardsForAgent(
  db: SupabaseClient,
  access: PageAccess,
  askerEmail: string,
  input: FindCardsInput
) {
  let boards = visibleBoards(access, await loadBoards(db)).filter((b) => !b.archived);
  if (input.board) {
    boards = boards.filter((b) => b.slug === input.board);
    if (boards.length === 0) return { error: `No board "${input.board}" you can open` };
  }
  if (boards.length === 0) return { count: 0, cards: [] };

  const [columns, cardsResult, fieldsResult] = await Promise.all([
    loadAllColumns(db),
    db
      .from('board_cards')
      .select('*')
      .in(
        'board_id',
        boards.map((b) => b.id)
      )
      .order('updated_at', { ascending: false })
      .limit(3000),
    db
      .from('board_fields')
      .select('board_id, key, label, kind')
      .in(
        'board_id',
        boards.map((b) => b.id)
      ),
  ]);
  if (cardsResult.error) throw new Error(cardsResult.error.message);
  const cards = (cardsResult.data ?? []) as BoardCardRow[];
  const fields = (fieldsResult.data ?? []) as (Pick<BoardFieldRow, 'key' | 'label' | 'kind'> & {
    board_id: string;
  })[];
  const columnById = new Map(columns.map((c) => [c.id, c]));
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const people = await getPeopleNames(cards.flatMap((c) => c.assignee_emails));
  const today = todayEastern();
  const terms = searchTerms(input.query ?? '');
  const state = input.state ?? 'open';

  const who = (input.assignee ?? '').trim().toLowerCase();
  const assigneeMatches = (card: BoardCardRow): boolean => {
    if (!who) return true;
    if (who === 'me') return card.assignee_emails.includes(askerEmail);
    return card.assignee_emails.some(
      (email) => email.includes(who) || personName(email, people).toLowerCase().includes(who)
    );
  };

  const matched = cards.filter((card) => {
    const kind = columnById.get(card.column_id)?.kind ?? 'open';
    if (state === 'open' && kind !== 'open') return false;
    if (state === 'finished' && kind === 'open') return false;
    if (!assigneeMatches(card)) return false;
    if (input.dueBy && (!card.due_date || card.due_date > input.dueBy)) return false;
    if (input.overdue && !(kind === 'open' && card.due_date && card.due_date < today)) return false;
    return cardMatches(
      card,
      terms,
      fields.filter((f) => f.board_id === card.board_id),
      people
    );
  });

  // Overdue and soonest-due first, then the most recently touched.
  matched.sort((a, b) => {
    const ad = a.due_date ?? '9999-99-99';
    const bd = b.due_date ?? '9999-99-99';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.updated_at < b.updated_at ? 1 : -1;
  });

  const limit = Math.min(Math.max(input.limit ?? 30, 1), MAX_CARDS);
  return {
    today,
    count: matched.length,
    cards: matched.slice(0, limit).map((card) => {
      const board = boardById.get(card.board_id) as BoardRow;
      return cardView(card, board, columnById.get(card.column_id), people, today);
    }),
  };
}
