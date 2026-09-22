// The cross-board calendar (/admin/boards/calendar): every dated thing on
// every board, and when each goal is due, on one month.
//
// This is the view that answers "what is actually happening" — the question
// All Tasks answers only for work we owe, and never against the dates the
// cards are about. A rental sits on the day it runs, its chase sits two
// weeks earlier, and a goal's target date is the horizon behind both.
//
// One month per request, cached per window (lib/client/cachedJson), so
// paging back to a month already opened repaints at once and revalidates
// behind it.
//
// Clicking an entry opens the card here rather than navigating to its board:
// a calendar is read by scanning across boards, and being thrown onto one of
// them to change a date loses the month you were looking at. The drawer is
// the same one the board page uses, and All Tasks already opens it across
// boards this way. The entry is still a link, so a modified click opens the
// board in a new tab.

import { useEffect, useMemo, useState } from 'react';
import {
  buildCalendar,
  type CalendarEntry,
  monthGridRange,
  monthStartOf,
  movePatch,
} from '@/lib/boards/calendar';
import type { Assignable } from '@/lib/boards/people';
import { BOARDS_HREF } from '@/lib/boards/types';
import { useCachedJson } from '@/lib/client/cachedJson';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow, BoardRow, GoalRow } from '@/lib/db';
import type { PeopleNames } from '@/lib/sops/names';
import { todayEastern, toolbarButtonClass } from '../goalsUi';
import { readError } from '../incidentUi';
import { filterChipClass } from '../scheduleUi';
import { CalendarMonth } from './CalendarMonth';
import { CardDrawer } from './CardDrawer';
import { useOptimisticCardSave } from './useOptimisticCardSave';

interface CalendarData {
  boards: BoardRow[];
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  cards: BoardCardRow[];
  goals: GoalRow[];
  people: PeopleNames;
  /** Everyone a card can be reassigned to, for the drawer's owner select. */
  owners: Assignable[];
  today: string;
}

// Distinct per-board hues, assigned by index order, the way the schedule
// calendar colours its people. Enough for far more boards than an index
// should ever hold.
const BOARD_COLORS = [
  '#5c9de0',
  '#e0b55c',
  '#7fc98a',
  '#b58ce0',
  '#5cc9c0',
  '#e08cb5',
  '#a8b55c',
  '#e0685c',
];

/** The chip a goal entry answers to; boards answer to their own id. */
const GOALS_KEY = '__goals__';

export function BoardsCalendar() {
  const [monthStart, setMonthStart] = useState(() => monthStartOf(todayEastern()));
  const [hideFinished, setHideFinished] = useState(false);
  // Empty means everything — the convention the schedule's people filter set.
  const [only, setOnly] = useState<ReadonlySet<string>>(new Set());

  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { gridStart, gridEnd } = useMemo(() => monthGridRange(monthStart), [monthStart]);
  const { data, error, loading, refreshing, reload, setData } = useCachedJson<CalendarData>(
    `/api/admin/boards-calendar?start=${gridStart}&end=${gridEnd}`
  );

  const today = data?.today ?? todayEastern();

  // Arriving from a notification or a shared link: #card-<id> names the card
  // to open, the same convention the board page and All Tasks follow.
  useEffect(() => {
    if (!data) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#card-')) return;
    const id = hash.slice('#card-'.length);
    if (data.cards.some((card) => card.id === id)) setOpenCardId(id);
  }, [data]);

  // The edited card is replaced in place, so the month keeps its scroll, its
  // chips, and everything else that is not this card.
  const saveCard = useOptimisticCardSave(data, setData);

  const entries = useMemo(() => {
    if (!data) return [];
    return buildCalendar(data, { start: gridStart, end: gridEnd, includeGoals: true });
  }, [data, gridStart, gridEnd]);

  // Only boards with something on this month get a chip: a list of every
  // board would be a second index, not a filter.
  const present = useMemo(() => {
    const ids = new Set(entries.flatMap((e) => (e.kind === 'goal' ? [] : [e.boardId ?? ''])));
    return (data?.boards ?? []).filter((board) => ids.has(board.id));
  }, [entries, data]);

  const colorFor = useMemo(() => {
    const map = new Map<string, string>();
    (data?.boards ?? []).forEach((board, index) => {
      map.set(board.id, BOARD_COLORS[index % BOARD_COLORS.length]);
    });
    return map;
  }, [data]);

  const shown = useMemo(
    () =>
      entries.filter((entry) => {
        if (hideFinished && entry.finished) return false;
        if (only.size === 0) return true;
        return only.has(chipKey(entry));
      }),
    [entries, hideFinished, only]
  );

  const toggle = (key: string) =>
    setOnly((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (loading && !data) return <p className="font-mono text-xs text-white/40">Loading…</p>;

  const hasGoals = entries.some((entry) => entry.kind === 'goal');
  const openCard = data?.cards.find((card) => card.id === openCardId) ?? null;
  // A card's drawer shows its own board's columns and questions, not every
  // board's — the same slicing All Tasks does when it opens one.
  const cardColumns = openCard
    ? (data?.columns ?? []).filter((column) => column.board_id === openCard.board_id)
    : [];
  const cardFields = openCard
    ? (data?.fields ?? []).filter((field) => field.board_id === openCard.board_id)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <a className={toolbarButtonClass} href={BOARDS_HREF}>
          ← All boards
        </a>
      </div>

      {(error || saveError) && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {saveError ?? error}
        </p>
      )}

      <CalendarMonth
        entries={shown}
        monthStart={monthStart}
        onMonthChange={setMonthStart}
        today={today}
        refreshing={refreshing}
        emptyNote="Nothing on any board is dated this month."
        colorOf={(entry) => (entry.boardId ? colorFor.get(entry.boardId) : undefined)}
        onMove={(entry, date) => {
          const move = movePatch(entry, date);
          if (!move) return;
          setSaveError(null);
          void saveCard(move.id, move.patch).catch((e: unknown) =>
            setSaveError(e instanceof Error ? e.message : 'Could not move that card')
          );
        }}
        onSelect={(entry) => {
          // A goal has no card to open, so its entry keeps the plain link
          // through to the board that serves it.
          if (entry.cardId) setOpenCardId(entry.cardId);
          else window.location.assign(entry.href);
        }}
        chips={
          <>
            {present.map((board) => (
              <button
                key={board.id}
                type="button"
                className={filterChipClass(only.has(board.id))}
                aria-pressed={only.has(board.id)}
                onClick={() => toggle(board.id)}
              >
                {board.name}
              </button>
            ))}
            {hasGoals && (
              <button
                type="button"
                className={filterChipClass(only.has(GOALS_KEY))}
                aria-pressed={only.has(GOALS_KEY)}
                onClick={() => toggle(GOALS_KEY)}
              >
                Goals
              </button>
            )}
            <button
              type="button"
              className={filterChipClass(hideFinished)}
              aria-pressed={hideFinished}
              title="Leave out cards that are already done or dropped"
              onClick={() => setHideFinished((value) => !value)}
            >
              Hide finished
            </button>
          </>
        }
        legend={present.map((board) => (
          <span key={board.id} style={{ color: colorFor.get(board.id) }}>
            ▪ {board.name}
          </span>
        ))}
      />

      {openCard && (
        <CardDrawer
          key={openCard.id}
          card={openCard}
          columns={cardColumns}
          fields={cardFields}
          people={data?.people ?? {}}
          owners={data?.owners ?? []}
          busy={busy}
          onClose={() => setOpenCardId(null)}
          onSave={async (patch) => {
            setSaveError(null);
            try {
              await saveCard(openCard.id, patch);
            } catch (e) {
              setSaveError(e instanceof Error ? e.message : 'That did not save');
              throw e;
            }
          }}
          onDelete={async () => {
            setBusy(true);
            setSaveError(null);
            try {
              const res = await fetch(`/api/admin/board-cards?id=${openCard.id}`, {
                method: 'DELETE',
              });
              if (!res.ok) throw new Error(await readError(res));
              setOpenCardId(null);
              await reload();
            } catch (e) {
              setSaveError(e instanceof Error ? e.message : 'That did not delete');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function chipKey(entry: CalendarEntry): string {
  return entry.kind === 'goal' ? GOALS_KEY : (entry.boardId ?? '');
}
