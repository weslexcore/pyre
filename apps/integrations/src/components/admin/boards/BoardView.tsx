// One board (/admin/boards/<slug>): the goal it serves on top, its columns
// side by side on a desk and stacked on a phone below, with a quick-add
// between them.
//
// This is the same island whether the board is the founders' task list or
// the rental pipeline — the columns, the fields, the noun, and the goal come
// from the board row, so a new pipeline needs no code. What a viewer may do
// is the server's answer: holding `board:rentals` works the cards and
// measures the KPIs here and nothing else, and `canManage` (the whole
// /admin/boards grant) is what unlocks renaming columns, the goal's
// definition, and the settings panel.
//
// A card moves by being dragged onto a column (dnd.tsx), or from the Column
// field in its drawer. Either way the move is applied to the page at once
// and confirmed by the server response; a refused move snaps back with the
// API's message.
//
// The same page also draws the board as a month (?view=calendar), because
// the bundle already holds everything a calendar needs — the cards, the
// fields that say which dates are events, and the board's own due-date
// switch. Keeping it here rather than on /admin/boards/<slug>/calendar means
// no second round trip, the search and owner filters narrow both views, and
// clicking a day opens the drawer that is already mounted.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cardsByColumn, columnPatch, defaultColumn } from '@/lib/boards/cards';
import { appendColumn, type renameColumn } from '@/lib/boards/columns';
import { formBuilderHref } from '@/lib/boards/forms';
import type { Assignable } from '@/lib/boards/people';
import { planDrop, sortOrdersFor } from '@/lib/boards/reorder';
import { cardMatches, searchTerms } from '@/lib/boards/search';
import { BOARDS_HREF } from '@/lib/boards/types';
import type {
  BoardCardRow,
  BoardColumnRow,
  BoardFieldRow,
  BoardRow,
  GoalKpiRow,
  GoalRow,
} from '@/lib/db';
import type { PeopleNames } from '@/lib/sops/names';
import { Confetti } from '../Confetti';
import { ActivityFeed } from '../goals/ActivityFeed';
import {
  cardClass,
  inputBaseClass,
  QuietChip,
  selectBaseClass,
  send,
  todayEastern,
  toolbarButtonClass,
} from '../goalsUi';
import { readError } from '../incidentUi';
import { pillClass } from '../scheduleUi';
import { BoardCalendar, boardHasCalendar } from './BoardCalendar';
import { BoardGoal } from './BoardGoal';
import { BoardSettings, type BoardSettingsHandle } from './BoardSettings';
import { CardDrawer } from './CardDrawer';
import { CardRow } from './CardRow';
import { AddColumn, ColumnHeader } from './ColumnHeader';
import {
  boardCollisions,
  DndContext,
  type DragEndEvent,
  DraggableCard,
  DragOverlay,
  type DragStartEvent,
  DroppableColumn,
  SortableColumn,
  useBoardSensors,
} from './dnd';
import { QuickAdd } from './QuickAdd';
import { useOptimisticCardSave } from './useOptimisticCardSave';

interface BundleResponse {
  board: BoardRow;
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  cards: BoardCardRow[];
  goal: GoalRow | null;
  kpis: GoalKpiRow[];
  unattachedGoals?: GoalRow[];
  people?: PeopleNames;
  owners?: Assignable[];
  canManage?: boolean;
  canWorkGoal?: boolean;
  today?: string;
  error?: string;
}

type ViewMode = 'board' | 'calendar';

/**
 * Which view a link asked for. Read once at module scope, the way
 * ScheduleBoard reads its own deep-link params: SSR sees no window and falls
 * back to the board, and the loading placeholder is the same either way, so
 * hydration stays clean.
 */
const initialView: ViewMode = (() => {
  if (typeof window === 'undefined') return 'board';
  return new URLSearchParams(window.location.search).get('view') === 'calendar'
    ? 'calendar'
    : 'board';
})();

export function BoardView({ slug }: { slug: string }) {
  const [view, setView] = useState<ViewMode>(initialView);
  const [bundle, setBundle] = useState<BundleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<BoardSettingsHandle>(null);
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [query, setQuery] = useState('');
  // Bumped when the goal is called met. A counter rather than a boolean so
  // reopening a goal and completing it again pops again — the Confetti
  // component's contract.
  const [burst, setBurst] = useState(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useBoardSensors();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/board-cards?board=${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(await readError(res));
      setBundle((await res.json()) as BundleResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this board');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Arriving from a notification or All Tasks: #card-<id> names the card to
  // open once the board has rendered.
  useEffect(() => {
    if (!bundle) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#card-')) return;
    const id = hash.slice('#card-'.length);
    if (bundle.cards.some((card) => card.id === id)) setOpenCardId(id);
  }, [bundle]);

  const saveCard = useOptimisticCardSave(bundle, setBundle);

  const today = bundle?.today ?? todayEastern();
  // The search box and the owner filter narrow what the columns show; the
  // cards themselves stay in the bundle, so a drop still knows every card
  // in the column it lands in.
  const cards = useMemo(() => {
    if (!bundle) return [];
    const terms = searchTerms(query);
    const people = bundle.people ?? {};
    return bundle.cards.filter((card) => {
      if (ownerFilter === 'none' && card.owner_email !== null) return false;
      if (ownerFilter !== 'all' && ownerFilter !== 'none' && card.owner_email !== ownerFilter) {
        return false;
      }
      return cardMatches(card, terms, bundle.fields, people);
    });
  }, [bundle, ownerFilter, query]);

  const grouped = useMemo(
    () => (bundle ? cardsByColumn(bundle.columns, cards) : []),
    [bundle, cards]
  );

  const openCard = bundle?.cards.find((card) => card.id === openCardId) ?? null;

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

  const addCard = async (title: string, columnId?: string) => {
    await mutate(() => send('/api/admin/board-cards', 'POST', { board: slug, title, columnId }));
  };

  // A drop is a column and the order it should hold afterwards. The order
  // shows at once, and so does the completion stamp a finished column
  // implies, so a card dragged into Done reads as done without a reload.
  // The column move (if any) goes through the card PATCH so the stamp and
  // notices are recorded in one place, and the row the server returns
  // replaces the guess; then the column is renumbered. A refused drop
  // reloads, which puts everything back.
  const dropCard = async (plan: NonNullable<ReturnType<typeof planDrop>>) => {
    const orders = sortOrdersFor(plan.orderedIds);
    const nowIso = new Date().toISOString();
    setBundle((current) => {
      if (!current) return current;
      const destination = current.columns.find((column) => column.id === plan.columnId);
      return {
        ...current,
        cards: current.cards.map((row) => {
          const order = orders.get(row.id);
          if (order === undefined) return row;
          const stamp =
            plan.moved && row.id === plan.card.id && destination
              ? columnPatch(row, destination, '', nowIso)
              : null;
          return { ...row, ...stamp, column_id: plan.columnId, sort_order: order };
        }),
      };
    });
    setBusy(true);
    setError(null);
    try {
      if (plan.moved) {
        const result = await send<{ card: BoardCardRow }>('/api/admin/board-cards', 'PATCH', {
          id: plan.card.id,
          columnId: plan.columnId,
        });
        setBundle((current) =>
          current
            ? {
                ...current,
                cards: current.cards.map((row) =>
                  row.id === result.card.id ? { ...result.card, sort_order: row.sort_order } : row
                ),
              }
            : current
        );
      }
      await send('/api/admin/board-cards/reorder', 'POST', {
        board: slug,
        columnId: plan.columnId,
        cardIds: plan.orderedIds,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not move this card');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onDragStart = (event: DragStartEvent) => setDraggingId(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    if (!bundle) return;
    const plan = planDrop(
      { activeId: String(event.active.id), overId: event.over ? String(event.over.id) : null },
      bundle.cards,
      bundle.columns
    );
    if (plan) void dropCard(plan);
  };

  if (loading && !bundle) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (!bundle) {
    return (
      <p className="text-sm text-[var(--pyre-red)]">{error ?? 'This board is not available.'}</p>
    );
  }

  const {
    board,
    columns,
    fields,
    goal,
    kpis,
    unattachedGoals = [],
    people = {},
    owners = [],
    canManage = false,
    canWorkGoal = false,
  } = bundle;
  const noun = board.card_noun;
  const quickAddColumn = defaultColumn(columns);
  const hasCalendar = boardHasCalendar(board, fields);

  // The view rides in the URL so a refresh, a back button, and a link shared
  // in a message all land where the person was. replaceState rather than
  // pushState: flipping the view is not a place you want to go back through.
  const showView = (next: ViewMode) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === 'calendar') url.searchParams.set('view', 'calendar');
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const ownerOptions = owners.length > 0 ? owners : namesAsOwners(people);

  const saveColumns = (next: ReturnType<typeof renameColumn>) =>
    mutate(() => send('/api/admin/boards', 'PATCH', { slug, columns: next }));

  const draggingCard = bundle.cards.find((card) => card.id === draggingId) ?? null;

  return (
    <div className="space-y-4">
      <Confetti burst={burst} />
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <a className={toolbarButtonClass} href={BOARDS_HREF}>
            ← All boards
          </a>
          {hasCalendar && (
            <span className="flex gap-1.5">
              <button
                type="button"
                className={pillClass(view === 'board')}
                aria-pressed={view === 'board'}
                onClick={() => showView('board')}
              >
                Board
              </button>
              <button
                type="button"
                className={pillClass(view === 'calendar')}
                aria-pressed={view === 'calendar'}
                onClick={() => showView('calendar')}
              >
                Calendar
              </button>
            </span>
          )}
          {canManage && (
            <a className={toolbarButtonClass} href={formBuilderHref(slug)}>
              Form
            </a>
          )}
          {board.archived && <QuietChip>archived</QuietChip>}
        </div>
        {/* One row, never wrapped: the shared select class is full-width by
            default, so the controls here are sized from the base class and
            the group as a whole drops under the link on a phone instead. */}
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="board-search">
            Search
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-white/40">
              <SearchIcon />
            </span>
            {/* A plain text input, like the global search: WebKit gives
                type="search" its own chrome and does not honour the left
                padding until the field is first painted with focus, which
                left the icon sitting on top of the placeholder. */}
            <input
              id="board-search"
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className={`${inputBaseClass} h-10 w-40 min-w-0 appearance-none pl-9 sm:w-56`}
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label className="sr-only" htmlFor="board-owner-filter">
            Filter by owner
          </label>
          <select
            id="board-owner-filter"
            className={`${selectBaseClass} h-10 w-auto max-w-40 shrink-0`}
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
          >
            <option value="all">Everyone</option>
            <option value="none">Unassigned</option>
            {ownerOptions.map((owner) => (
              <option key={owner.email} value={owner.email}>
                {owner.name}
              </option>
            ))}
          </select>
          {canManage && (
            <button
              type="button"
              aria-label={settingsOpen ? 'Close board settings' : 'Board settings'}
              aria-expanded={settingsOpen}
              aria-controls="board-settings"
              title="Board settings"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition-colors ${
                settingsOpen
                  ? 'border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]'
                  : 'border-white/20 text-[var(--pyre-creme)] hover:border-white/40 hover:bg-white/10'
              }`}
              onClick={async () => {
                if (settingsOpen && !(await settingsRef.current?.flush())) return;
                setSettingsOpen((open) => !open);
              }}
            >
              <GearIcon />
            </button>
          )}
        </div>
      </div>

      {settingsOpen && canManage && (
        <div id="board-settings">
          <BoardSettings
            ref={settingsRef}
            board={board}
            columns={columns}
            fields={fields}
            cardCount={bundle.cards.length}
            busy={busy}
            onSaved={(result) =>
              setBundle((current) => (current ? { ...current, ...result } : current))
            }
          />
        </div>
      )}

      <BoardGoal
        board={board}
        goal={goal}
        kpis={kpis}
        cards={bundle.cards}
        columns={columns}
        people={people}
        owners={ownerOptions}
        unattachedGoals={unattachedGoals}
        today={today}
        canManage={canManage}
        canWorkGoal={canWorkGoal}
        busy={busy}
        mutate={mutate}
        onCompleted={() => setBurst((n) => n + 1)}
      />

      {quickAddColumn && (
        <QuickAdd noun={noun} busy={busy} onAdd={(title) => addCard(title, quickAddColumn.id)} />
      )}

      {view === 'calendar' && hasCalendar ? (
        <BoardCalendar
          board={board}
          columns={columns}
          fields={fields}
          cards={cards}
          today={today}
          onOpenCard={setOpenCardId}
          onMoveCard={(cardId, patch) => {
            // saveCard shows the move at once and puts it back with the
            // API's message if the write is refused.
            void saveCard(cardId, patch).catch((e: unknown) =>
              setError(e instanceof Error ? e.message : 'Could not move that card')
            );
          }}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollisions}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDraggingId(null)}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {grouped.map(({ column, cards: columnCards }) => (
              <DroppableColumn
                key={column.id}
                column={column}
                className={`${cardClass} min-w-0`}
                disabled={busy}
              >
                <ColumnHeader
                  column={column}
                  count={columnCards.length}
                  noun={noun}
                  busy={busy}
                  onAdd={column.archived ? undefined : (title) => addCard(title, column.id)}
                />
                <div className="min-h-16 space-y-2">
                  {columnCards.length === 0 && (
                    <p className="font-mono text-xs text-white/30">
                      {draggingCard && !column.archived ? 'Drop it here.' : 'Nothing here.'}
                    </p>
                  )}
                  <SortableColumn cardIds={columnCards.map((card) => card.id)}>
                    {columnCards.map((card) => (
                      <DraggableCard key={card.id} card={card} disabled={busy}>
                        {({ listeners, attributes }) => (
                          <CardRow
                            card={card}
                            columns={columns}
                            people={people}
                            today={today}
                            fields={fields}
                            dragProps={{ ...listeners, ...attributes }}
                            onOpen={(next) => setOpenCardId(next.id)}
                          />
                        )}
                      </DraggableCard>
                    ))}
                  </SortableColumn>
                </div>
              </DroppableColumn>
            ))}
            {canManage && (
              <AddColumn busy={busy} onAdd={(label) => saveColumns(appendColumn(columns, label))} />
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {draggingCard && (
              <CardRow
                card={draggingCard}
                columns={columns}
                people={people}
                today={today}
                fields={fields}
                ghost
                onOpen={() => undefined}
              />
            )}
          </DragOverlay>
        </DndContext>
      )}

      {goal && (
        <section className={cardClass}>
          <ActivityFeed
            goalId={goal.id}
            subjectTitle={goal.title}
            columns={columns}
            people={people}
            heading="Goal activity"
          />
        </section>
      )}

      {openCard && (
        <CardDrawer
          key={openCard.id}
          card={openCard}
          columns={columns}
          fields={fields}
          people={people}
          owners={ownerOptions}
          busy={busy}
          onClose={() => setOpenCardId(null)}
          onSave={(patch) => saveCard(openCard.id, patch)}
          onDelete={async () => {
            await mutate(() => send(`/api/admin/board-cards?id=${openCard.id}`, 'DELETE'));
            setOpenCardId(null);
          }}
        />
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 12l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.3 3.5h3.4l.5 2.3a6.9 6.9 0 0 1 1.7 1l2.2-.8 1.7 3-1.8 1.5a7 7 0 0 1 0 2l1.8 1.5-1.7 3-2.2-.8a6.9 6.9 0 0 1-1.7 1l-.5 2.3h-3.4l-.5-2.3a6.9 6.9 0 0 1-1.7-1l-2.2.8-1.7-3 1.8-1.5a7 7 0 0 1 0-2L4.2 9l1.7-3 2.2.8a6.9 6.9 0 0 1 1.7-1l.5-2.3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * The fallback owner list for a single-board grantee, who is not handed the
 * roster: the people already named on this board. Enough to filter by and to
 * reassign between, without turning a pipeline grant into a staff directory.
 */
function namesAsOwners(people: PeopleNames): Assignable[] {
  return Object.entries(people)
    .map(([email, name]) => ({ email, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
