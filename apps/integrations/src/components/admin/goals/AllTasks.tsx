// /admin/boards/tasks: everything in flight, wherever it is filed.
//
// This is the Monday-morning page, and the two strips at the top are the
// only things on it that are genuinely urgent: what is late, and what is due
// before Sunday. Below that the work groups by board — so a task always
// reads in the context of the goal its board is for — with owner as the
// other lens. Every task is on a board, so each open one appears once
// below the strips; New task (above the page) is how a quick one is added.
//
// Finished work is out of the way under "Recently done", by the week it
// landed in, which is the other question the founders ask each other and
// Trello could never answer.

import { type ReactNode, useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { Assignable } from '@/lib/boards/people';
import { cardMatches, searchTerms } from '@/lib/boards/search';
import { readError, sendJson } from '@/lib/client/api';
import { useLoadingBar } from '@/lib/client/loadingBar';
import type { BoardCardRow } from '@/lib/db';
import { buildAllTasks } from '@/lib/goals/allTasks';
import type { AllTasksData } from '@/lib/goals/store';
import type { GroupBy } from '@/lib/goals/types';
import { GROUP_BY } from '@/lib/goals/types';
import { CardDrawer } from '../boards/CardDrawer';
import { CardRow } from '../boards/CardRow';
import { SearchField } from '../boards/SearchField';
import { useCardDeepLink } from '../boards/useCardDeepLink';
import { useOptimisticCardSave } from '../boards/useOptimisticCardSave';
import { cardClass, inputBaseClass, selectBaseClass } from '../goalsUi';
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

// Which sections this person has folded away, remembered in this browser
// only: it is a reading preference, not something anyone else should see.
// Storage can be missing or refuse (a private window), so every touch is
// guarded and the page simply starts with everything open.
const COLLAPSED_KEY = 'admin:all-tasks:collapsed';

function readCollapsed(): ReadonlySet<string> {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(keys: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...keys]));
  } catch {
    // Not remembered; the toggle still works for this visit.
  }
}

/**
 * One section of the page — a strip, a board or a person, Recently done —
 * whose heading folds its cards away. The count stays on the heading, so a
 * folded section still says how much is in it. `extra` sits beside the
 * toggle rather than inside it, so a link or a date field there is its own
 * control.
 */
function TaskSection({
  title,
  count,
  collapsed,
  onToggle,
  extra,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <section className={cardClass}>
      <div className={`flex items-center justify-between gap-3 ${collapsed ? '' : 'mb-3'}`}>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left font-mono text-xs uppercase tracking-wide text-white/50 hover:text-white/80"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden="true"
            className={`shrink-0 transition-transform motion-reduce:transition-none ${collapsed ? '-rotate-90' : ''}`}
          >
            <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <h2 className="min-w-0 truncate">{title}</h2>
          <span className="shrink-0 text-[11px] text-white/35">{count}</span>
        </button>
        {extra}
      </div>
      <div id={bodyId} hidden={collapsed}>
        {children}
      </div>
    </section>
  );
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readCollapsed);
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

  const toggleSection = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeCollapsed(next);
      return next;
    });
  };

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
        <TaskSection
          title="Overdue"
          count={built.overdue.length}
          collapsed={collapsed.has('overdue')}
          onToggle={() => toggleSection('overdue')}
        >
          <div className="space-y-2">{rowsFor(built.overdue)}</div>
        </TaskSection>
      )}

      {built.dueThisWeek.length > 0 && (
        <TaskSection
          title="Due this week"
          count={built.dueThisWeek.length}
          collapsed={collapsed.has('week')}
          onToggle={() => toggleSection('week')}
        >
          <div className="space-y-2">{rowsFor(built.dueThisWeek)}</div>
        </TaskSection>
      )}

      {built.groups.map((group) => {
        const key = `${groupBy}:${group.key}`;
        return (
          <TaskSection
            key={group.key}
            title={group.label}
            count={group.cards.length}
            collapsed={collapsed.has(key)}
            onToggle={() => toggleSection(key)}
            extra={
              group.boardSlug && (
                <a
                  className="font-mono text-[11px] uppercase tracking-wide text-white/35 underline-offset-4 hover:text-white/70 hover:underline"
                  href={`/admin/boards/${group.boardSlug}`}
                >
                  Open board
                </a>
              )
            }
          >
            <div className="space-y-2">{rowsFor(group.cards, groupBy !== 'board')}</div>
          </TaskSection>
        );
      })}

      <TaskSection
        title="Recently done"
        count={built.recentlyDone.reduce((sum, week) => sum + week.cards.length, 0)}
        collapsed={collapsed.has('done')}
        onToggle={() => toggleSection('done')}
        extra={
          <span className="flex items-center gap-2 font-mono text-[11px] text-white/35">
            <label htmlFor="tasks-since">since</label>
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
      </TaskSection>

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
