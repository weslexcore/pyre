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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cardsByColumn, defaultColumn } from '@/lib/boards/cards';
import { appendColumn, type renameColumn } from '@/lib/boards/columns';
import type { Assignable } from '@/lib/boards/people';
import { planDrop, sortOrdersFor } from '@/lib/boards/reorder';
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
import { buttonClass, cardClass, QuietChip, selectClass, send, todayEastern } from '../goalsUi';
import { readError } from '../incidentUi';
import { BoardGoal } from './BoardGoal';
import { BoardSettings } from './BoardSettings';
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

export function BoardView({ slug }: { slug: string }) {
  const [bundle, setBundle] = useState<BundleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState('all');
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
  const cards = useMemo(() => {
    if (!bundle) return [];
    if (ownerFilter === 'all') return bundle.cards;
    if (ownerFilter === 'none') return bundle.cards.filter((c) => c.owner_email === null);
    return bundle.cards.filter((c) => c.owner_email === ownerFilter);
  }, [bundle, ownerFilter]);

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
  // shows at once; the column move (if any) goes through the card PATCH so
  // completion stamps and notices happen in one place, then the column is
  // renumbered. A refused drop reloads, which puts everything back.
  const dropCard = async (plan: NonNullable<ReturnType<typeof planDrop>>) => {
    const orders = sortOrdersFor(plan.orderedIds);
    setBundle((current) =>
      current
        ? {
            ...current,
            cards: current.cards.map((row) => {
              const order = orders.get(row.id);
              if (order === undefined) return row;
              return { ...row, column_id: plan.columnId, sort_order: order };
            }),
          }
        : current
    );
    setBusy(true);
    setError(null);
    try {
      if (plan.moved) {
        await send('/api/admin/board-cards', 'PATCH', {
          id: plan.card.id,
          columnId: plan.columnId,
        });
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
  const ownerOptions = owners.length > 0 ? owners : namesAsOwners(people);

  const saveColumns = (next: ReturnType<typeof renameColumn>) =>
    mutate(() => send('/api/admin/boards', 'PATCH', { slug, columns: next }));

  const draggingCard = bundle.cards.find((card) => card.id === draggingId) ?? null;

  return (
    <div className="space-y-4">
      <Confetti burst={burst} />
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <a
            className="font-mono text-xs text-white/40 underline hover:text-white/70"
            href={BOARDS_HREF}
          >
            ← All boards
          </a>
          {board.archived && <QuietChip>archived</QuietChip>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="board-owner-filter">
            Filter by owner
          </label>
          <select
            id="board-owner-filter"
            className={`${selectClass} w-auto`}
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
              className={buttonClass}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              {settingsOpen ? 'Close settings' : 'Board settings'}
            </button>
          )}
        </div>
      </div>

      {settingsOpen && canManage && (
        <BoardSettings
          board={board}
          columns={columns}
          fields={fields}
          cardCount={bundle.cards.length}
          busy={busy}
          onSaved={() => void load()}
        />
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

      <DndContext
        sensors={sensors}
        collisionDetection={boardCollisions}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {grouped.map(({ column, cards: columnCards }) => (
            <DroppableColumn key={column.id} column={column} className={cardClass} disabled={busy}>
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
