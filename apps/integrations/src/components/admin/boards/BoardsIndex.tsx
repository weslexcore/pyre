// /admin/boards: the boards this person may open, under their sections,
// each with the goal it serves — its status, its pace, how many KPIs are
// met, how much of the work is still open. New boards are made from the row
// above the page (CreateActions).
// Arranging the sections is BoardSections' job. A board whose goal has been
// called met leaves its section for Completed, at the bottom, so the
// sections only ever hold work still in flight.
//
// A board with its form switched on carries the form's link on its card,
// with a Copy button beside it, so handing the form out is one click.
//
// A single-board grantee sees exactly one card here and no New board form —
// the list itself is filtered server-side, so the page never even tells them
// what else exists.

import { todayEastern } from '@pyre/schedule-core';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { formHref } from '@/lib/boards/forms';
import type { Assignable } from '@/lib/boards/people';
import { boardsInOrder, splitCompletedBoards } from '@/lib/boards/sections';
import type { BoardTally, UpNextCard } from '@/lib/boards/store';
import { readError } from '@/lib/client/api';
import { useLoadingBar } from '@/lib/client/loadingBar';
import type { BoardRow, BoardSectionRow, GoalKpiRow, GoalRow } from '@/lib/db';
import { goalKpiSummary } from '@/lib/goals/kpis';
import { daysLeft, formatDaysLeft, paceState } from '@/lib/goals/progress';
import {
  cardClass,
  formatYmd,
  GoalStatusBadge,
  KpiMeter,
  PaceChip,
  QuietChip,
  SectionTitle,
} from '../goalsUi';
import { BoardSections } from './BoardSections';
import { UpNext } from './UpNext';

interface BoardsResponse {
  boards: BoardRow[];
  sections: BoardSectionRow[];
  goals: GoalRow[];
  kpis: GoalKpiRow[];
  tallies: BoardTally[];
  formBoardIds: string[];
  /** The viewer's next few dated cards. */
  upNext?: UpNextCard[];
  /** How many dated cards are on the viewer, the ones upNext leaves out included. */
  upNextTotal?: number;
  canManage?: boolean;
  owners?: Assignable[];
  unattachedGoals?: GoalRow[];
}

export function BoardsIndex() {
  const [data, setData] = useState<BoardsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/boards');
      if (!res.ok) throw new Error(await readError(res));
      setData((await res.json()) as BoardsResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the boards');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The first load holds the header's loading bar, so moving between
  // views reads as one load from click to content.
  useLoadingBar(loading && !data);

  if (loading && !data) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (!data) {
    return <p className="text-sm text-[var(--pyre-red)]">{error ?? 'Boards are not available.'}</p>;
  }

  const { boards, sections, goals, kpis, tallies, canManage = false } = data;
  const _owners = data.owners ?? [];
  const _unattached = data.unattachedGoals ?? [];
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  const talliesByBoard = new Map(tallies.map((tally) => [tally.board_id, tally]));
  const formBoardIds = new Set(data.formBoardIds ?? []);
  const today = todayEastern();
  const nowIso = new Date().toISOString();

  const { live: active, completed } = splitCompletedBoards(
    boardsInOrder(
      boards.filter((board) => !board.archived),
      sections
    ),
    goalsById
  );
  const archived = boards.filter((board) => board.archived);

  const cardFor = (board: BoardRow, handle: ReactNode = null) => (
    <BoardCard
      key={board.id}
      board={board}
      goal={board.goal_id ? (goalsById.get(board.goal_id) ?? null) : null}
      kpis={board.goal_id ? kpis.filter((kpi) => kpi.goal_id === board.goal_id) : []}
      tally={talliesByBoard.get(board.id) ?? { board_id: board.id, open: 0, total: 0 }}
      hasForm={formBoardIds.has(board.id)}
      today={today}
      nowIso={nowIso}
      handle={handle}
    />
  );

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      <UpNext cards={data.upNext ?? []} total={data.upNextTotal} today={today} />

      {(active.length > 0 || sections.length > 0) && (
        <BoardSections
          sections={sections}
          boards={active}
          canManage={canManage}
          busy={false}
          renderBoard={cardFor}
          onChanged={load}
          onError={setError}
        />
      )}

      {!loading && boards.length === 0 && (
        <p className="text-sm text-white/50">
          {canManage
            ? 'No boards yet. Make the first one — what are you actually trying to achieve?'
            : 'No boards have been shared with you.'}
        </p>
      )}

      {completed.length > 0 && (
        <section>
          <SectionTitle note={String(completed.length)}>Completed</SectionTitle>
          <div className="grid grid-cols-1 gap-3 opacity-75 sm:grid-cols-2">
            {completed.map((board) => cardFor(board))}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section>
          <SectionTitle note={String(archived.length)}>Archived</SectionTitle>
          <div className="grid grid-cols-1 gap-3 opacity-60 sm:grid-cols-2">
            {archived.map(cardFor)}
          </div>
        </section>
      )}
    </div>
  );
}

function BoardCard({
  board,
  goal,
  kpis,
  tally,
  hasForm,
  today,
  nowIso,
  handle = null,
}: {
  board: BoardRow;
  goal: GoalRow | null;
  kpis: GoalKpiRow[];
  tally: BoardTally;
  /** The board's form is switched on, so its link belongs on the card. */
  hasForm: boolean;
  today: string;
  nowIso: string;
  /** The drag grip, placed beside the name; null for a viewer who cannot arrange. */
  handle?: ReactNode;
}) {
  const kpiSummary = goalKpiSummary(kpis);
  const done = tally.total - tally.open;
  const donePct = tally.total > 0 ? Math.round((done / tally.total) * 100) : 0;
  // Pace follows the outcome when there is one to follow, and the output when
  // there is not — the same rule as goalRollup.
  const pace = goal
    ? paceState(goal, kpiSummary.total > 0 ? kpiSummary.pct : donePct, today)
    : null;
  const left = goal ? daysLeft(goal.target_date, today) : null;

  return (
    <div className={`${cardClass} relative min-w-0 transition-colors hover:border-white/25`}>
      {handle && <div className="absolute top-2 right-2">{handle}</div>}
      <a href={`/admin/boards/${board.slug}`} className="block">
        <div className={`flex items-baseline justify-between gap-2 ${handle ? 'pr-8' : ''}`}>
          <h2 className="min-w-0 break-words font-primary-semibold text-[var(--pyre-creme)]">
            {board.name}
          </h2>
          {board.archived && <QuietChip>archived</QuietChip>}
        </div>
        {board.description && <p className="mt-1 text-sm text-white/55">{board.description}</p>}

        {goal ? (
          <div className="mt-3 border-t border-white/10 pt-3">
            <p className="break-words text-sm text-[var(--pyre-creme)]">{goal.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <GoalStatusBadge status={goal.status} />
              {pace && <PaceChip pace={pace} />}
              {goal.target_date && (
                <QuietChip>
                  {formatYmd(goal.target_date)} · {formatDaysLeft(left)}
                </QuietChip>
              )}
            </div>
            {kpis.length > 0 && (
              <div className="mt-3 space-y-2">
                {kpis.slice(0, 3).map((kpi) => (
                  <KpiMeter key={kpi.id} kpi={kpi} nowIso={nowIso} compact />
                ))}
                <p className="font-mono text-[10px] text-white/30">
                  {kpiSummary.met} of {kpiSummary.total} KPIs met
                  {kpis.length > 3 && ` · +${kpis.length - 3} more`}
                </p>
              </div>
            )}
          </div>
        ) : null}

        <p className="mt-3 font-mono text-[11px] text-white/35">
          {tally.open} open {tally.open === 1 ? board.card_noun : `${board.card_noun}s`}
          {tally.total > tally.open && ` · ${done} done`}
          {board.include_in_all_tasks ? ' · on All Tasks' : ' · its own queue'}
        </p>
      </a>
      {hasForm && <FormLinkRow slug={board.slug} />}
    </div>
  );
}

/** The board's public form: a link to open it and, apart from it, a button that copies it. */
function FormLinkRow({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const href = formHref(slug);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${href}`);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
      <span className="font-mono text-[10px] uppercase tracking-wide text-white/35">Form</span>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--pyre-gold)] hover:underline"
      >
        {href}
      </a>
      <button
        type="button"
        className="shrink-0 rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-white/70 transition-colors hover:border-white/30 hover:text-white"
        onClick={() => void copy()}
      >
        {copied ? 'Copied' : failed ? 'Copy failed' : 'Copy link'}
      </button>
    </div>
  );
}
