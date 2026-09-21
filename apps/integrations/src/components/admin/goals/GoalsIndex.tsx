// /admin/goals: every goal as a card — its owner, its target, how it is
// pacing, its KPI meters, and the share of its tasks that are done.
//
// Active first and by default, because a list that opens on everything ever
// written down is the Trello board again. Sub-goals nest under their parent
// rather than sitting beside it, so a long-term goal reads as the thing its
// midterm goals add up to.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Assignable } from '@/lib/boards/people';
import type { GoalRow } from '@/lib/db';
import { formatDaysLeft, goalRollup } from '@/lib/goals/progress';
import type { GoalsIndexData } from '@/lib/goals/store';
import type { GoalStatusValue } from '@/lib/goals/types';
import { AREAS, GOAL_STATUS_LABELS, GOAL_STATUSES, GOALS_HREF } from '@/lib/goals/types';
import { personName } from '@/lib/sops/names';
import {
  buttonClass,
  cardClass,
  formatYmd,
  GoalStatusBadge,
  KpiMeter,
  PaceChip,
  QuietChip,
  selectClass,
  send,
  TaskBar,
} from '../goalsUi';
import { readError } from '../incidentUi';
import { GoalForm } from './GoalForm';

type IndexData = GoalsIndexData & { owners?: Assignable[] };

/** Statuses the filter offers, plus the catch-all. */
const STATUS_FILTERS = ['active', ...GOAL_STATUSES.filter((s) => s !== 'active'), 'all'] as const;

export function GoalsIndex() {
  const [data, setData] = useState<IndexData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/goals');
      if (!res.ok) throw new Error(await readError(res));
      setData((await res.json()) as IndexData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the goals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // ?new=1 from the "New goal" search result opens the form straight away.
    if (new URLSearchParams(window.location.search).get('new')) setCreating(true);
  }, [load]);

  const columnsById = useMemo(
    () => new Map((data?.columns ?? []).map((column) => [column.id, column])),
    [data]
  );

  const matches = useCallback(
    (goal: GoalRow) =>
      (statusFilter === 'all' || goal.status === statusFilter) &&
      (ownerFilter === 'all' ||
        (ownerFilter === 'none' ? goal.owner_email === null : goal.owner_email === ownerFilter)) &&
      (areaFilter === 'all' || goal.area === areaFilter),
    [statusFilter, ownerFilter, areaFilter]
  );

  if (loading && !data) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (!data) {
    return <p className="text-sm text-[var(--pyre-red)]">{error ?? 'Goals are not available.'}</p>;
  }

  const { goals, kpis, cards, people, today } = data;
  const owners = data.owners ?? [];
  const nowIso = new Date().toISOString();

  // A parent shows if it matches, or if any of its children do — hiding a
  // parent because it is 'planned' would hide the active work under it.
  const childrenOf = (id: string) => goals.filter((goal) => goal.parent_id === id);
  const tops = goals
    .filter((goal) => goal.parent_id === null)
    .filter((goal) => matches(goal) || childrenOf(goal.id).some(matches));

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="goal-status-filter">
          Status
        </label>
        <select
          id="goal-status-filter"
          className={`${selectClass} w-auto`}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option} value={option}>
              {option === 'all' ? 'Every status' : GOAL_STATUS_LABELS[option as GoalStatusValue]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="goal-owner-filter">
          Owner
        </label>
        <select
          id="goal-owner-filter"
          className={`${selectClass} w-auto`}
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
        >
          <option value="all">Anyone</option>
          <option value="none">Nobody yet</option>
          {owners.map((owner) => (
            <option key={owner.email} value={owner.email}>
              {owner.name}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="goal-area-filter">
          Area
        </label>
        <select
          id="goal-area-filter"
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

        <span className="flex-1" />

        <a className={buttonClass} href="/admin/goals/tasks">
          All tasks
        </a>
        {!creating && (
          <button type="button" className={buttonClass} onClick={() => setCreating(true)}>
            New goal
          </button>
        )}
      </div>

      {creating && (
        <GoalForm
          goals={goals}
          owners={owners}
          busy={busy}
          onCancel={() => setCreating(false)}
          onSave={async (values) => {
            setBusy(true);
            try {
              await send('/api/admin/goals', 'POST', values);
              setCreating(false);
              await load();
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {tops.length === 0 && (
        <p className="text-sm text-white/50">
          {goals.length === 0
            ? 'No goals yet. Write down the first one — what are you actually trying to achieve?'
            : 'Nothing matches those filters.'}
        </p>
      )}

      <div className="space-y-3">
        {tops.map((goal) => {
          const children = childrenOf(goal.id);
          return (
            <div key={goal.id} className="space-y-2">
              <GoalCard
                goal={goal}
                rollup={goalRollup(goal, children, cards, kpis, columnsById, today)}
                kpis={kpis.filter((kpi) => kpi.goal_id === goal.id)}
                people={people}
                nowIso={nowIso}
              />
              {children.filter(matches).length > 0 && (
                <div className="ml-4 space-y-2 border-l border-white/10 pl-4">
                  {children.filter(matches).map((child) => (
                    <GoalCard
                      key={child.id}
                      goal={child}
                      rollup={goalRollup(child, [], cards, kpis, columnsById, today)}
                      kpis={kpis.filter((kpi) => kpi.goal_id === child.id)}
                      people={people}
                      nowIso={nowIso}
                      compact
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GoalCard({
  goal,
  rollup,
  kpis,
  people,
  nowIso,
  compact = false,
}: {
  goal: GoalRow;
  rollup: ReturnType<typeof goalRollup>;
  kpis: IndexData['kpis'];
  people: IndexData['people'];
  nowIso: string;
  compact?: boolean;
}) {
  return (
    <a
      href={`${GOALS_HREF}/${goal.id}`}
      className={`${cardClass} block transition-colors hover:border-white/25`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2
          className={`font-primary-semibold text-[var(--pyre-creme)] ${compact ? 'text-sm' : ''}`}
        >
          {goal.title}
        </h2>
        <span className="flex flex-wrap items-center gap-2">
          <GoalStatusBadge status={goal.status} />
          <PaceChip pace={rollup.pace} />
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {goal.owner_email && <QuietChip>{personName(goal.owner_email, people)}</QuietChip>}
        {goal.area && <QuietChip>{goal.area}</QuietChip>}
        {goal.target_date && (
          <QuietChip>
            {formatYmd(goal.target_date)} · {formatDaysLeft(rollup.daysLeft)}
          </QuietChip>
        )}
        {rollup.childCount > 0 && <QuietChip>{rollup.childCount} sub-goals</QuietChip>}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TaskBar progress={rollup.tasks} />
        {kpis.length > 0 && (
          <div className="space-y-2">
            {kpis.slice(0, 3).map((kpi) => (
              <KpiMeter key={kpi.id} kpi={kpi} nowIso={nowIso} compact />
            ))}
            {kpis.length > 3 && (
              <p className="font-mono text-[10px] text-white/30">+{kpis.length - 3} more KPIs</p>
            )}
          </div>
        )}
      </div>
    </a>
  );
}
