// /admin/boards/tasks: everything in flight, wherever it is filed.
//
// This is the Monday-morning page, and the two strips at the top are the
// only things on it that are genuinely urgent: what is late, and what is due
// before Sunday. Below that the work groups by board — so a task always
// reads in the context of the goal its board is for — with owner as the
// other lens, and the unfiled chores (cards on a board with no goal) in a
// section of their own so a quick thing still has an obvious home.
//
// Finished work is out of the way under "Recently done", by the week it
// landed in, which is the other question the founders ask each other and
// Trello could never answer.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultColumn } from '@/lib/boards/cards';
import type { Assignable } from '@/lib/boards/people';
import { cardMatches, searchTerms } from '@/lib/boards/search';
import { GOALS_BOARD_SLUG } from '@/lib/boards/types';
import { readError, sendJson } from '@/lib/client/api';
import { useLoadingBar } from '@/lib/client/loadingBar';
import type { BoardCardRow } from '@/lib/db';
import { buildAllTasks } from '@/lib/goals/allTasks';
import type { AllTasksData } from '@/lib/goals/store';
import type { GroupBy } from '@/lib/goals/types';
import { GROUP_BY } from '@/lib/goals/types';
import { CardDrawer } from '../boards/CardDrawer';
import { CardRow } from '../boards/CardRow';
import { QuickAdd } from '../boards/QuickAdd';
import { SearchField } from '../boards/SearchField';
import { useCardDeepLink } from '../boards/useCardDeepLink';
import { useOptimisticCardSave } from '../boards/useOptimisticCardSave';
import { cardClass, inputBaseClass, SectionTitle, selectBaseClass } from '../goalsUi';
import { filterChipClass } from '../scheduleUi';

type TasksData = AllTasksData & { owners?: Assignable[] };

const GROUP_LABELS: Record<GroupBy, string> = {
  board: 'By board',
  owner: 'By person',
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

  const [groupBy, setGroupBy] = useState<GroupBy>('board');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [query, setQuery] = useState('');
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

  useCardDeepLink(data?.cards, setOpenCardId, { drawerOpen: openCardId !== null, reload: load });

  const saveCard = useOptimisticCardSave(data, setData);

  // The search matches what a board's own search does: title, notes, who
  // owns it, what it is waiting on, and its area.
  const filtered = useMemo(() => {
    if (!data) return [];
    const terms = searchTerms(query);
    return data.cards.filter(
      (card) =>
        (ownerFilter === 'all' ||
          (ownerFilter === 'none'
            ? card.assignee_emails.length === 0
            : card.assignee_emails.includes(ownerFilter))) &&
        (!waitingOnly || card.waiting_on !== null) &&
        cardMatches(card, terms, [], data.people)
    );
  }, [data, ownerFilter, waitingOnly, query]);

  const built = useMemo(() => {
    if (!data) return null;
    return buildAllTasks(filtered, data.boards, data.columns, data.people, {
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

  // The first load holds the header's loading bar, so moving between
  // views reads as one load from click to content.
  useLoadingBar(loading && !data);

  if (loading && !data) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (!data || !built) {
    return <p className="text-sm text-[var(--pyre-red)]">{error ?? 'Tasks are not available.'}</p>;
  }

  const { boards, columns, people, today } = data;
  const owners = data.owners ?? [];
  const openCard = data.cards.find((card) => card.id === openCardId) ?? null;
  const boardNames = new Map(boards.map((board) => [board.id, board.name]));

  const tasksBoard = boards.find((board) => board.slug === GOALS_BOARD_SLUG) ?? boards[0];
  const tasksColumns = columns.filter((column) => column.board_id === tasksBoard?.id);

  const terms = searchTerms(query);
  const rowsFor = (cards: BoardCardRow[], showBoard = true) =>
    cards.map((card) => (
      <CardRow
        key={card.id}
        card={card}
        columns={columns.filter((column) => column.board_id === card.board_id)}
        people={people}
        today={today}
        boardName={showBoard && boards.length > 1 ? boardNames.get(card.board_id) : undefined}
        onOpen={(next) => setOpenCardId(next.id)}
        highlight={terms}
      />
    ));

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      {/* The same compact row a board's own filters use: controls sized from
          the base classes, so none of them stretches across the page. */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchField id="tasks-search" value={query} onChange={setQuery} />
        <label className="sr-only" htmlFor="tasks-group-by">
          Group by
        </label>
        <select
          id="tasks-group-by"
          className={`${selectBaseClass} h-10 w-auto max-w-40 shrink-0`}
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
          Filter by owner
        </label>
        <select
          id="tasks-owner"
          className={`${selectBaseClass} h-10 w-auto max-w-40 shrink-0`}
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
        >
          <option value="all">Everyone</option>
          <option value="none">Unassigned</option>
          {owners.map((owner) => (
            <option key={owner.email} value={owner.email}>
              {owner.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={filterChipClass(waitingOnly)}
          aria-pressed={waitingOnly}
          onClick={() => setWaitingOnly((value) => !value)}
        >
          Waiting on something
        </button>
      </div>

      {query.trim() && filtered.length === 0 && (
        <p className="text-sm text-white/50">No tasks match “{query.trim()}”.</p>
      )}

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
            {group.boardSlug ? (
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
          <div className="space-y-2">{rowsFor(group.cards, groupBy !== 'board')}</div>
        </section>
      ))}

      <section className={cardClass}>
        <SectionTitle note={String(built.unfiled.length)}>Unfiled</SectionTitle>
        <p className="mb-3 text-xs text-white/35">
          One-off chores on a board with no goal behind it. Not every task needs one.
        </p>
        {tasksBoard && defaultColumn(tasksColumns) && (
          <div className="mb-3">
            <QuickAdd
              noun={tasksBoard.card_noun}
              busy={busy}
              onAdd={(title) =>
                mutate(() =>
                  sendJson('/api/admin/board-cards', 'POST', { board: tasksBoard.slug, title })
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
          key={openCard.id}
          card={openCard}
          board={boards.find((board) => board.id === openCard.board_id)}
          columns={columns.filter((column) => column.board_id === openCard.board_id)}
          fields={[]}
          people={people}
          owners={owners}
          busy={busy}
          onClose={() => setOpenCardId(null)}
          onSave={(patch) => saveCard(openCard.id, patch)}
          onDelete={async () => {
            await mutate(() => sendJson(`/api/admin/board-cards?id=${openCard.id}`, 'DELETE'));
            setOpenCardId(null);
          }}
        />
      )}
    </div>
  );
}
