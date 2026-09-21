// /admin/goals/<id>: the hub, and the page the whole tool is built around.
//
// Reading down it: what we are trying to achieve, the KPIs that say whether
// we got there, the sub-goals that roll up to it, the tasks that advance it,
// and what has happened. Two progress reads that never merge — the KPI
// meters are outcome, the task bar is output — because the case that matters
// is exactly the one where they disagree.
//
// Completion is a button, never a consequence. Pressing it opens a dialog
// showing both numbers and asking what was true; the answer is stored on the
// goal and in its trail.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultColumn } from '@/lib/boards/cards';
import type { Assignable } from '@/lib/boards/people';
import { GOALS_BOARD_SLUG } from '@/lib/boards/types';
import type { GoalKpiRow } from '@/lib/db';
import { completionPreview } from '@/lib/goals/access';
import { formatDaysLeft, goalRollup } from '@/lib/goals/progress';
import type { GoalPageData } from '@/lib/goals/store';
import { GOALS_HREF } from '@/lib/goals/types';
import { personName } from '@/lib/sops/names';
import { CardDrawer } from '../boards/CardDrawer';
import { QuickAdd } from '../boards/QuickAdd';
import { Confetti } from '../Confetti';
import { ConfirmDialog } from '../ConfirmDialog';
import {
  buttonClass,
  cardClass,
  formatYmd,
  GoalStatusBadge,
  PaceChip,
  primaryButtonClass,
  QuietChip,
  SectionTitle,
  send,
  TaskBar,
} from '../goalsUi';
import { readError } from '../incidentUi';
import { SopMarkdown } from '../SopMarkdown';
import { ActivityFeed } from './ActivityFeed';
import { CompleteGoalDialog } from './CompleteGoalDialog';
import { GoalForm } from './GoalForm';
import { KpiForm } from './KpiForm';
import { KpiRow } from './KpiRow';
import { TaskList } from './TaskList';

type PageData = GoalPageData & { owners?: Assignable[] };

export function GoalPage({ goalId }: { goalId: string }) {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [kpiFormFor, setKpiFormFor] = useState<GoalKpiRow | 'new' | null>(null);
  const [removingKpi, setRemovingKpi] = useState<GoalKpiRow | null>(null);
  const [completing, setCompleting] = useState(false);
  // Bumped when a goal is called met. A counter rather than a boolean so
  // reopening a goal and completing it again pops again — the Confetti
  // component's contract.
  const [burst, setBurst] = useState(0);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/goals?id=${encodeURIComponent(goalId)}`);
      if (!res.ok) throw new Error(await readError(res));
      setData((await res.json()) as PageData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this goal');
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Landing from All Tasks or a deep link: #card-<id> opens that card.
  useEffect(() => {
    if (!data) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#card-')) return;
    const id = hash.slice('#card-'.length);
    if (data.cards.some((card) => card.id === id)) setOpenCardId(id);
  }, [data]);

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

  const columnsById = useMemo(
    () => new Map((data?.columns ?? []).map((column) => [column.id, column])),
    [data]
  );

  const rollup = useMemo(() => {
    if (!data) return null;
    return goalRollup(data.goal, data.children, data.cards, data.kpis, columnsById, data.today);
  }, [data, columnsById]);

  if (loading && !data) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (!data || !rollup) {
    return (
      <p className="text-sm text-[var(--pyre-red)]">{error ?? 'This goal is not available.'}</p>
    );
  }

  const { goal, parent, children, kpis, cards, columns, boards, goals, people, today } = data;
  const owners = data.owners ?? [];
  const nowIso = new Date().toISOString();
  const openCard = cards.find((card) => card.id === openCardId) ?? null;

  // Quick-add files a task under this goal, on the founders' task board.
  const tasksBoard = boards.find((board) => board.slug === GOALS_BOARD_SLUG) ?? boards[0];
  const tasksColumns = columns.filter((column) => column.board_id === tasksBoard?.id);
  const quickAddColumn = defaultColumn(tasksColumns);

  const ownKpis = kpis.filter((kpi) => kpi.goal_id === goal.id);
  const ownCards = cards.filter((card) => card.goal_id === goal.id);
  const goalTitles = new Map(goals.map((row) => [row.id, row.title]));

  const preview = completionPreview(kpis, cards, columnsById);

  return (
    <div className="space-y-6">
      <Confetti burst={burst} />
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      {parent && (
        <p className="font-mono text-xs text-white/40">
          Rolls up to{' '}
          <a className="underline hover:text-white/70" href={`${GOALS_HREF}/${parent.id}`}>
            {parent.title}
          </a>
        </p>
      )}

      {editing ? (
        <GoalForm
          goal={goal}
          goals={goals}
          owners={owners}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (values) => {
            await mutate(() => send('/api/admin/goals', 'PATCH', { id: goal.id, ...values }));
            setEditing(false);
          }}
        />
      ) : (
        <header className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="font-primary-semibold text-xl text-[var(--pyre-creme)]">{goal.title}</h1>
            <div className="flex gap-2">
              <button type="button" className={buttonClass} onClick={() => setEditing(true)}>
                Edit
              </button>
              {goal.status !== 'completed' && (
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={busy}
                  onClick={() => setCompleting(true)}
                >
                  Mark completed
                </button>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <GoalStatusBadge status={goal.status} />
            <PaceChip pace={rollup.pace} />
            {goal.owner_email && <QuietChip>{personName(goal.owner_email, people)}</QuietChip>}
            {goal.area && <QuietChip>{goal.area}</QuietChip>}
            {goal.target_date && (
              <QuietChip>
                {formatYmd(goal.target_date)} · {formatDaysLeft(rollup.daysLeft)}
              </QuietChip>
            )}
          </div>

          <div className="mt-3 max-w-sm">
            <TaskBar progress={rollup.tasks} />
          </div>

          {goal.description_md.trim() && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <SopMarkdown content={goal.description_md} />
            </div>
          )}

          {goal.status === 'completed' && (
            <p className="mt-4 border-t border-white/10 pt-3 text-sm text-white/60">
              Completed{goal.completed_by ? ` by ${personName(goal.completed_by, people)}` : ''}
              {goal.completed_at ? ` on ${goal.completed_at.slice(0, 10)}` : ''}.
              {goal.completion_note && (
                <span className="mt-1 block whitespace-pre-wrap text-white/50">
                  {goal.completion_note}
                </span>
              )}
            </p>
          )}
        </header>
      )}

      <section>
        <SectionTitle
          note={
            rollup.kpis.total > 0 ? `${rollup.kpis.met} of ${rollup.kpis.total} met` : 'none yet'
          }
        >
          KPIs
        </SectionTitle>

        {ownKpis.length === 0 && kpiFormFor === null && (
          <p className="mb-2 font-mono text-xs text-white/35">
            No KPIs yet. Without one, “met” is a feeling.
          </p>
        )}

        <ul className="space-y-2">
          {ownKpis.map((kpi) => (
            <KpiRow
              key={kpi.id}
              kpi={kpi}
              nowIso={nowIso}
              busy={busy}
              onEdit={() => setKpiFormFor(kpi)}
              onRemove={() => setRemovingKpi(kpi)}
              onMeasure={(value) =>
                mutate(() =>
                  send('/api/admin/goal-kpis', 'PATCH', { id: kpi.id, currentValue: value })
                )
              }
            />
          ))}
        </ul>

        {kpiFormFor === null ? (
          <button
            type="button"
            className={`${buttonClass} mt-2`}
            onClick={() => setKpiFormFor('new')}
          >
            Add a KPI
          </button>
        ) : (
          <div className="mt-2">
            <KpiForm
              kpi={kpiFormFor === 'new' ? undefined : kpiFormFor}
              busy={busy}
              onCancel={() => setKpiFormFor(null)}
              onSave={async (values) => {
                if (kpiFormFor === 'new') {
                  await mutate(() =>
                    send('/api/admin/goal-kpis', 'POST', { goalId: goal.id, ...values })
                  );
                } else {
                  await mutate(() =>
                    send('/api/admin/goal-kpis', 'PATCH', { id: kpiFormFor.id, ...values })
                  );
                }
                setKpiFormFor(null);
              }}
            />
          </div>
        )}
      </section>

      {children.length > 0 && (
        <section>
          <SectionTitle note={`${children.length} rolling up`}>Sub-goals</SectionTitle>
          <div className="space-y-2">
            {children.map((child) => {
              const childRollup = goalRollup(child, [], cards, kpis, columnsById, today);
              return (
                <a
                  key={child.id}
                  href={`${GOALS_HREF}/${child.id}`}
                  className={`${cardClass} block transition-colors hover:border-white/25`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-[var(--pyre-creme)]">{child.title}</span>
                    <span className="flex items-center gap-2">
                      <GoalStatusBadge status={child.status} />
                      <PaceChip pace={childRollup.pace} />
                    </span>
                  </div>
                  <div className="mt-2 max-w-xs">
                    <TaskBar progress={childRollup.tasks} />
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <SectionTitle note={`${rollup.tasks.open} open`}>Tasks</SectionTitle>
        {tasksBoard && quickAddColumn && (
          <div className="mb-3">
            <QuickAdd
              noun={tasksBoard.card_noun}
              placeholder={`Add a ${tasksBoard.card_noun} under this goal…`}
              busy={busy}
              onAdd={(title) =>
                mutate(() =>
                  send('/api/admin/board-cards', 'POST', {
                    board: tasksBoard.slug,
                    title,
                    goalId: goal.id,
                  })
                )
              }
            />
          </div>
        )}
        <TaskList
          cards={cards}
          columns={columns}
          boards={boards}
          people={people}
          today={today}
          busy={busy}
          goalTitles={
            // Only label a card when it belongs to a sub-goal rather than this one.
            new Map([...goalTitles].filter(([id]) => id !== goal.id))
          }
          onOpen={(card) => setOpenCardId(card.id)}
          onMove={(card, columnId) =>
            void mutate(() => send('/api/admin/board-cards', 'PATCH', { id: card.id, columnId }))
          }
        />
        {ownCards.length === 0 && children.length > 0 && (
          <p className="mt-2 font-mono text-xs text-white/35">
            Everything above is filed under a sub-goal.
          </p>
        )}
      </section>

      <section className={cardClass}>
        <ActivityFeed
          goalId={goal.id}
          subjectTitle={goal.title}
          columns={columns}
          people={people}
        />
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

      {completing && (
        <CompleteGoalDialog
          goalTitle={goal.title}
          preview={preview}
          busy={busy}
          onCancel={() => setCompleting(false)}
          onConfirm={(note) => {
            setCompleting(false);
            void mutate(async () => {
              const saved = await send('/api/admin/goals', 'PATCH', {
                id: goal.id,
                status: 'completed',
                completionNote: note || null,
              });
              // Only once it has actually landed — a goal that failed to save
              // does not get a celebration.
              setBurst((n) => n + 1);
              return saved;
            });
          }}
        />
      )}

      {removingKpi && (
        <ConfirmDialog
          title={`Remove “${removingKpi.name}”?`}
          body="The KPI and every measurement on it go with it. The goal keeps its tasks and its history."
          confirmLabel="Remove"
          danger
          busy={busy}
          onCancel={() => setRemovingKpi(null)}
          onConfirm={() => {
            const id = removingKpi.id;
            setRemovingKpi(null);
            void mutate(() => send(`/api/admin/goal-kpis?id=${id}`, 'DELETE'));
          }}
        />
      )}
    </div>
  );
}
