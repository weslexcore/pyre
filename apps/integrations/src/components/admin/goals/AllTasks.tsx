// /admin/goals/tasks: everything in flight, wherever it is filed.
//
// This is the Monday-morning page, and the two strips at the top are the
// only things on it that are genuinely urgent: what is late, and what is due
// before Sunday. Below that the work groups by goal — so a task always reads
// in the context of what it is for — with owner and board as the other two
// lenses, and the unfiled chores in a section of their own so a quick thing
// with no goal behind it still has an obvious home.
//
// Finished work is out of the way under "Recently done", by the week it
// landed in, which is the other question the founders ask each other and
// Trello could never answer.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultColumn } from '@/lib/boards/cards';
import type { Assignable } from '@/lib/boards/people';
import { GOALS_BOARD_SLUG } from '@/lib/boards/types';
import type { BoardCardRow } from '@/lib/db';
import { buildAllTasks } from '@/lib/goals/allTasks';
import type { AllTasksData } from '@/lib/goals/store';
import type { GroupBy } from '@/lib/goals/types';
import { AREAS, GOALS_HREF, GROUP_BY } from '@/lib/goals/types';
import { CardDrawer } from '../boards/CardDrawer';
import { CardRow } from '../boards/CardRow';
import { QuickAdd } from '../boards/QuickAdd';
import {
  buttonClass,
  cardClass,
  inputBaseClass,
  SectionTitle,
  selectClass,
  send,
} from '../goalsUi';
import { readError } from '../incidentUi';

type TasksData = AllTasksData & { owners?: Assignable[] };

const GROUP_LABELS: Record<GroupBy, string> = {
  goal: 'By goal',
  owner: 'By person',
  board: 'By board',
};

/** How far back Recently done reaches by default — four weeks. */
function defaultSince(): string {
  return new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
}

export function AllTasks({ viewerEmail = '' }: { viewerEmail?: string }) {
  const [data, setData] = useState<TasksData | null>(null);
  const [since, setSince] = useState(defaultSince);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [groupBy, setGroupBy] = useState<GroupBy>('goal');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/all-tasks?since=${encodeURIComponent(since)}`);
      if (!res.ok) throw new Error(await readError(res));
      setData((await res.json()) as TasksData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the tasks');
    } finally {
      setLoading(false);
    }
  }, [since]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#card-')) return;
    const id = hash.slice('#card-'.length);
    if (data.cards.some((card) => card.id === id)) setOpenCardId(id);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.cards.filter(
      (card) =>
        (ownerFilter === 'all' ||
          (ownerFilter === 'none'
            ? card.owner_email === null
            : card.owner_email === ownerFilter)) &&
        (areaFilter === 'all' || card.area === areaFilter) &&
        (!waitingOnly || card.waiting_on !== null)
    );
  }, [data, ownerFilter, areaFilter, waitingOnly]);

  const built = useMemo(() => {
    if (!data) return null;
    return buildAllTasks(filtered, data.goals, data.boards, data.columns, data.people, {
      today: data.today,
      viewerEmail,
      groupBy,
    });
  }, [data, filtered, groupBy, viewerEmail]);

  const mutate = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (!data || !built) {
    return <p className="text-sm text-[var(--pyre-red)]">{error ?? 'Tasks are not available.'}</p>;
  }

  const { goals, boards, columns, people, today } = data;
  const owners = data.owners ?? [];
  const openCard = data.cards.find((card) => card.id === openCardId) ?? null;
  const goalTitles = new Map(goals.map((goal) => [goal.id, goal.title]));
  const boardNames = new Map(boards.map((board) => [board.id, board.name]));

  const tasksBoard = boards.find((board) => board.slug === GOALS_BOARD_SLUG) ?? boards[0];
  const tasksColumns = columns.filter((column) => column.board_id === tasksBoard?.id);

  const rowsFor = (cards: BoardCardRow[], showGoal = true) =>
    cards.map((card) => (
      <CardRow
        key={card.id}
        card={card}
        columns={columns.filter((column) => column.board_id === card.board_id)}
        people={people}
        today={today}
        goalTitle={showGoal && card.goal_id ? goalTitles.get(card.goal_id) : undefined}
        boardName={boards.length > 1 ? boardNames.get(card.board_id) : undefined}
        busy={busy}
        onOpen={(next) => setOpenCardId(next.id)}
        onMove={(next, columnId) =>
          void mutate(() => send('/api/admin/board-cards', 'PATCH', { id: next.id, columnId }))
        }
      />
    ));

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="tasks-group-by">
          Group by
        </label>
        <select
          id="tasks-group-by"
          className={`${selectClass} w-auto`}
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
        >
          {GROUP_BY.map((option) => (
            <option key={option} value={option}>
              {GROUP_LABELS[option]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="tasks-owner">
          Owner
        </label>
        <select
          id="tasks-owner"
          className={`${selectClass} w-auto`}
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
        >
          <option value="all">Anyone</option>
          <option value="none">Unassigned</option>
          {owners.map((owner) => (
            <option key={owner.email} value={owner.email}>
              {owner.name}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="tasks-area">
          Area
        </label>
        <select
          id="tasks-area"
          className={`${selectClass} w-auto`}
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
        >
          <option value="all">Every area</option>
          {AREAS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-white/60">
          <input
            type="checkbox"
            checked={waitingOnly}
            onChange={(e) => setWaitingOnly(e.target.checked)}
          />
          Waiting on something
        </label>

        <span className="flex-1" />
        <a className={buttonClass} href={GOALS_HREF}>
          Goals
        </a>
      </div>

      {built.overdue.length > 0 && (
        <section className={cardClass}>
          <SectionTitle note={String(built.overdue.length)}>Overdue</SectionTitle>
          <div className="space-y-2">{rowsFor(built.overdue)}</div>
        </section>
      )}

      {built.dueThisWeek.length > 0 && (
        <section className={cardClass}>
          <SectionTitle note={String(built.dueThisWeek.length)}>Due this week</SectionTitle>
          <div className="space-y-2">{rowsFor(built.dueThisWeek)}</div>
        </section>
      )}

      {built.groups.map((group) => (
        <section key={group.key} className={cardClass}>
          <SectionTitle note={String(group.cards.length)}>
            {group.goalId ? (
              <a className="underline hover:text-white/80" href={`${GOALS_HREF}/${group.goalId}`}>
                {group.label}
              </a>
            ) : group.boardSlug ? (
              <a
                className="underline hover:text-white/80"
                href={`/admin/boards/${group.boardSlug}`}
              >
                {group.label}
              </a>
            ) : (
              group.label
            )}
          </SectionTitle>
          <div className="space-y-2">{rowsFor(group.cards, groupBy !== 'goal')}</div>
        </section>
      ))}

      <section className={cardClass}>
        <SectionTitle note={String(built.unfiled.length)}>Unfiled</SectionTitle>
        <p className="mb-3 text-xs text-white/35">
          One-off chores with no goal behind them. Not every task needs one.
        </p>
        {tasksBoard && defaultColumn(tasksColumns) && (
          <div className="mb-3">
            <QuickAdd
              noun={tasksBoard.card_noun}
              busy={busy}
              onAdd={(title) =>
                mutate(() =>
                  send('/api/admin/board-cards', 'POST', { board: tasksBoard.slug, title })
                )
              }
            />
          </div>
        )}
        <div className="space-y-2">{rowsFor(built.unfiled)}</div>
      </section>

      <section className={cardClass}>
        <SectionTitle
          note={
            <span className="flex items-center gap-2">
              <label htmlFor="tasks-since" className="text-white/35">
                since
              </label>
              <input
                id="tasks-since"
                className={`${inputBaseClass} w-36 py-1`}
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
            </span>
          }
        >
          Recently done
        </SectionTitle>
        {built.recentlyDone.length === 0 && (
          <p className="font-mono text-xs text-white/35">Nothing finished in that window.</p>
        )}
        <div className="space-y-4">
          {built.recentlyDone.map((week) => (
            <div key={week.weekStart}>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-white/35">
                {week.label}
              </p>
              <div className="space-y-2">{rowsFor(week.cards)}</div>
            </div>
          ))}
        </div>
      </section>

      {openCard && (
        <CardDrawer
          card={openCard}
          columns={columns.filter((column) => column.board_id === openCard.board_id)}
          fields={[]}
          goals={goals}
          people={people}
          owners={owners}
          busy={busy}
          onClose={() => setOpenCardId(null)}
          onSave={(patch) =>
            mutate(() => send('/api/admin/board-cards', 'PATCH', { id: openCard.id, ...patch }))
          }
          onDelete={async () => {
            await mutate(() => send(`/api/admin/board-cards?id=${openCard.id}`, 'DELETE'));
            setOpenCardId(null);
          }}
        />
      )}
    </div>
  );
}
