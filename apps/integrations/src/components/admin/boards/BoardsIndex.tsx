// /admin/boards: the boards this person may open, under their sections,
// each with the goal it serves — its status, its pace, how many KPIs are
// met, how much of the work is still open — and the form for a new one.
// Arranging the sections is BoardSections' job. A board whose goal has been
// called met leaves its section for Completed, at the bottom, so the
// sections only ever hold work still in flight.
//
// A single-board grantee sees exactly one card here and no New board form —
// the list itself is filtered server-side, so the page never even tells them
// what else exists.

import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import type { Assignable } from '@/lib/boards/people';
import { boardsInOrder, sectionsInOrder, splitCompletedBoards } from '@/lib/boards/sections';
import type { BoardTally } from '@/lib/boards/store';
import { BOARD_LIMITS, slugOf } from '@/lib/boards/types';
import type { BoardRow, BoardSectionRow, GoalKpiRow, GoalRow } from '@/lib/db';
import { goalKpiSummary } from '@/lib/goals/kpis';
import { daysLeft, formatDaysLeft, paceState } from '@/lib/goals/progress';
import { ALL_GOALS_HREF, ALL_TASKS_HREF } from '@/lib/goals/types';
import {
  buttonClass,
  cardClass,
  formatYmd,
  GoalStatusBadge,
  inputClass,
  KpiMeter,
  labelClass,
  PaceChip,
  primaryButtonClass,
  QuietChip,
  SectionTitle,
  selectClass,
  send,
  todayEastern,
} from '../goalsUi';
import { readError } from '../incidentUi';
import { BoardSections } from './BoardSections';

interface BoardsResponse {
  boards: BoardRow[];
  sections: BoardSectionRow[];
  goals: GoalRow[];
  kpis: GoalKpiRow[];
  tallies: BoardTally[];
  canManage?: boolean;
  owners?: Assignable[];
  unattachedGoals?: GoalRow[];
}

// What a brand-new board starts with. Every board needs somewhere open to
// put a card and somewhere to finish it; the rest is the owner's to add.
const STARTER_COLUMNS = [
  { key: 'new', label: 'New', kind: 'open', sortOrder: 10 },
  { key: 'in_progress', label: 'In progress', kind: 'open', sortOrder: 20 },
  { key: 'done', label: 'Done', kind: 'done', sortOrder: 30 },
];

/** The goal picker's two fixed choices, ahead of the goals nobody serves yet. */
const NO_GOAL = '';
const NEW_GOAL = '__new__';

export function BoardsIndex() {
  const [data, setData] = useState<BoardsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [cardNoun, setCardNoun] = useState('task');
  const [includeInAllTasks, setIncludeInAllTasks] = useState(true);
  const [sectionId, setSectionId] = useState('');
  const [goalChoice, setGoalChoice] = useState<string>(NEW_GOAL);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalOwner, setGoalOwner] = useState('');
  const [busy, setBusy] = useState(false);

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

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const goal =
        goalChoice === NEW_GOAL
          ? {
              goal: {
                title: goalTitle,
                targetDate: goalTarget || null,
                ownerEmail: goalOwner || null,
                status: 'active',
              },
            }
          : goalChoice === NO_GOAL
            ? {}
            : { goalId: goalChoice };
      await send('/api/admin/boards', 'POST', {
        name,
        slug: slug || slugOf(name),
        cardNoun,
        includeInAllTasks,
        sectionId: sectionId || null,
        ...goal,
        columns: STARTER_COLUMNS,
      });
      setName('');
      setSlug('');
      setSlugTouched(false);
      setGoalTitle('');
      setGoalTarget('');
      setGoalOwner('');
      setGoalChoice(NEW_GOAL);
      setCreating(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that board');
    } finally {
      setBusy(false);
    }
  };

  const suggested = slugTouched ? slug : slugOf(name);
  const needsGoalTitle = goalChoice === NEW_GOAL && !goalTitle.trim();

  if (loading && !data) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (!data) {
    return <p className="text-sm text-[var(--pyre-red)]">{error ?? 'Boards are not available.'}</p>;
  }

  const { boards, sections, goals, kpis, tallies, canManage = false } = data;
  const owners = data.owners ?? [];
  const unattached = data.unattachedGoals ?? [];
  const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
  const talliesByBoard = new Map(tallies.map((tally) => [tally.board_id, tally]));
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
      today={today}
      nowIso={nowIso}
      handle={handle}
    />
  );

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      {(canManage || boards.length > 0) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canManage && (
            <a className={buttonClass} href={ALL_GOALS_HREF}>
              All goals
            </a>
          )}
          {canManage && (
            <a className={buttonClass} href={ALL_TASKS_HREF}>
              All tasks
            </a>
          )}
          {canManage && !creating && (
            <button type="button" className={buttonClass} onClick={() => setCreating(true)}>
              New board
            </button>
          )}
        </div>
      )}

      {canManage && creating && (
        <form onSubmit={create} className={cardClass}>
          <SectionTitle>New board</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="new-board-name">
                Name
              </label>
              <input
                id="new-board-name"
                className={inputClass}
                type="text"
                maxLength={BOARD_LIMITS.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="new-board-slug">
                URL name
              </label>
              <input
                id="new-board-slug"
                className={inputClass}
                type="text"
                maxLength={BOARD_LIMITS.slug}
                placeholder={slugOf(name) || 'group-bookings'}
                value={suggested}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
              <p className="mt-1 text-xs text-white/35">
                Permanent: it is the address and the grant key (board:{suggested || '…'}).
              </p>
            </div>
            <div>
              <label className={labelClass} htmlFor="new-board-noun">
                One card is a…
              </label>
              <input
                id="new-board-noun"
                className={inputClass}
                type="text"
                maxLength={BOARD_LIMITS.cardNoun}
                value={cardNoun}
                onChange={(e) => setCardNoun(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="new-board-section">
                Section
              </label>
              <select
                id="new-board-section"
                className={selectClass}
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
              >
                <option value="">Other boards</option>
                {sectionsInOrder(sections).map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="new-board-goal">
                Goal
              </label>
              <select
                id="new-board-goal"
                className={selectClass}
                value={goalChoice}
                onChange={(e) => setGoalChoice(e.target.value)}
              >
                <option value={NEW_GOAL}>Write a new goal</option>
                <option value={NO_GOAL}>No goal — it is just a list</option>
                {unattached.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {goalChoice === NEW_GOAL && (
            <div className="mt-4 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="new-board-goal-title">
                  What is this board for?
                </label>
                <input
                  id="new-board-goal-title"
                  className={inputClass}
                  type="text"
                  maxLength={200}
                  placeholder="Ten private rentals booked by December"
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                />
                <p className="mt-1 text-xs text-white/35">
                  The KPIs that say whether it worked come next, on the board.
                </p>
              </div>
              <div>
                <label className={labelClass} htmlFor="new-board-goal-target">
                  Target date
                </label>
                <input
                  id="new-board-goal-target"
                  className={inputClass}
                  type="date"
                  value={goalTarget}
                  onChange={(e) => setGoalTarget(e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="new-board-goal-owner">
                  Who is driving it
                </label>
                <select
                  id="new-board-goal-owner"
                  className={selectClass}
                  value={goalOwner}
                  onChange={(e) => setGoalOwner(e.target.value)}
                >
                  <option value="">Nobody yet</option>
                  {owners.map((owner) => (
                    <option key={owner.email} value={owner.email}>
                      {owner.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <label className="mt-4 flex items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={includeInAllTasks}
              onChange={(e) => setIncludeInAllTasks(e.target.checked)}
            />
            Show these cards on All Tasks
          </label>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={buttonClass} onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className={primaryButtonClass}
              disabled={busy || !name.trim() || !suggested || needsGoalTitle}
            >
              {busy ? 'Creating…' : 'Create board'}
            </button>
          </div>
          <p className="mt-2 text-xs text-white/35">
            It starts with New / In progress / Done — rename them, add your own, on the board.
          </p>
        </form>
      )}

      {(active.length > 0 || sections.length > 0) && (
        <BoardSections
          sections={sections}
          boards={active}
          canManage={canManage}
          busy={busy}
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
          <div className="grid gap-3 opacity-75 sm:grid-cols-2">
            {completed.map((board) => cardFor(board))}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section>
          <SectionTitle note={String(archived.length)}>Archived</SectionTitle>
          <div className="grid gap-3 opacity-60 sm:grid-cols-2">{archived.map(cardFor)}</div>
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
  today,
  nowIso,
  handle = null,
}: {
  board: BoardRow;
  goal: GoalRow | null;
  kpis: GoalKpiRow[];
  tally: BoardTally;
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
    <div className={`${cardClass} relative transition-colors hover:border-white/25`}>
      {handle && <div className="absolute top-2 right-2">{handle}</div>}
      <a href={`/admin/boards/${board.slug}`} className="block">
        <div className={`flex items-baseline justify-between gap-2 ${handle ? 'pr-8' : ''}`}>
          <h2 className="font-primary-semibold text-[var(--pyre-creme)]">{board.name}</h2>
          {board.archived && <QuietChip>archived</QuietChip>}
        </div>
        {board.description && <p className="mt-1 text-sm text-white/55">{board.description}</p>}

        {goal ? (
          <div className="mt-3 border-t border-white/10 pt-3">
            <p className="text-sm text-[var(--pyre-creme)]">{goal.title}</p>
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
        ) : (
          <p className="mt-3 border-t border-white/10 pt-3 font-mono text-xs text-white/35">
            No goal yet
          </p>
        )}

        <p className="mt-3 font-mono text-[11px] text-white/35">
          {tally.open} open {tally.open === 1 ? board.card_noun : `${board.card_noun}s`}
          {tally.total > tally.open && ` · ${done} done`}
          {board.include_in_all_tasks ? ' · on All Tasks' : ' · its own queue'}
        </p>
      </a>
    </div>
  );
}
