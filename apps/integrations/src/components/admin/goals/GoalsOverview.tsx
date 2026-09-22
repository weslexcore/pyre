// /admin/boards/all-goals: every goal on one page, where it stands, and the
// board that serves it. Clicking a goal opens that board.
//
// The strip at the top is the whole page in five numbers; below it the goals
// sit under their status — active, then planned, then the closed ones
// dimmed under a rule — and within a status the ones that need a look first
// (lib/goals/overview). Each row carries the same chips and meters the board and the
// index draw, so a goal reads the same here as everywhere else. Task
// progress and KPI progress stay side by side and never merge — the case
// worth catching is exactly the one where the work is done and the number
// is not.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BOARDS_HREF } from '@/lib/boards/types';
import type { GoalOverviewRow, GoalStatusGroup } from '@/lib/goals/overview';
import {
  buildGoalRows,
  filterRows,
  groupByStatus,
  NO_OWNER,
  summarize,
} from '@/lib/goals/overview';
import { formatDaysLeft } from '@/lib/goals/progress';
import type { GoalsOverviewData } from '@/lib/goals/store';
import { GOAL_STATUS_LABELS, isClosedStatus } from '@/lib/goals/types';
import { personName } from '@/lib/sops/names';
import {
  cardClass,
  formatYmd,
  GoalStatusBadge,
  KpiMeter,
  labelClass,
  PaceChip,
  QuietChip,
  SectionTitle,
  selectClass,
  TaskBar,
} from '../goalsUi';
import { readError } from '../incidentUi';

export function GoalsOverview() {
  const [data, setData] = useState<GoalsOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState('all');
  const [area, setArea] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/goals');
      if (!res.ok) throw new Error(await readError(res));
      setData((await res.json()) as GoalsOverviewData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the goals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => (data ? buildGoalRows(data, data.today) : []), [data]);

  // The filter choices come from the goals themselves, so the lists only
  // ever offer a person or an area that would show something.
  const owners = useMemo(() => {
    const emails = [
      ...new Set(rows.flatMap((row) => (row.goal.owner_email ? [row.goal.owner_email] : []))),
    ];
    const named = emails
      .map((email) => ({ email, name: personName(email, data?.people) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const unowned = rows.some((row) => !row.goal.owner_email);
    return { named, unowned };
  }, [rows, data]);
  const areas = useMemo(
    () => [...new Set(rows.flatMap((row) => (row.goal.area ? [row.goal.area] : [])))].sort(),
    [rows]
  );

  const shown = useMemo(() => filterRows(rows, { owner, area }), [rows, owner, area]);
  const summary = useMemo(() => summarize(shown), [shown]);
  const groups = useMemo(() => groupByStatus(shown), [shown]);
  const open = groups.filter((group) => !isClosedStatus(group.status));
  const closed = groups.filter((group) => isClosedStatus(group.status));

  if (loading && !data) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (!data) {
    return <p className="text-sm text-[var(--pyre-red)]">{error ?? 'Goals are not available.'}</p>;
  }

  const nowIso = new Date().toISOString();

  return (
    <div className="space-y-6">
      <a
        className="inline-block font-mono text-xs text-white/40 underline hover:text-white/70"
        href={BOARDS_HREF}
      >
        ← All boards
      </a>
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Active" value={summary.byStatus.active} />
        <Stat label="Planned" value={summary.byStatus.planned} />
        <Stat
          label="Overdue"
          value={summary.overdue}
          tone={summary.overdue > 0 ? 'text-[var(--pyre-red)]' : undefined}
        />
        <Stat
          label="Behind"
          value={summary.behind}
          tone={summary.behind > 0 ? 'text-[var(--pyre-gold)]' : undefined}
        />
        <Stat
          label="KPIs met"
          value={summary.kpisTotal > 0 ? `${summary.kpisMet} / ${summary.kpisTotal}` : '—'}
          tone={
            summary.kpisTotal > 0 && summary.kpisMet === summary.kpisTotal
              ? 'text-[var(--pyre-sage)]'
              : undefined
          }
        />
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className={labelClass} htmlFor="goals-owner">
              Driven by
            </label>
            <select
              id="goals-owner"
              className={`${selectClass} w-auto`}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="all">Everyone</option>
              {owners.named.map((person) => (
                <option key={person.email} value={person.email}>
                  {person.name}
                </option>
              ))}
              {owners.unowned && <option value={NO_OWNER}>Nobody yet</option>}
            </select>
          </div>
          {areas.length > 0 && (
            <div>
              <label className={labelClass} htmlFor="goals-area">
                Area
              </label>
              <select
                id="goals-area"
                className={`${selectClass} w-auto`}
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                <option value="all">All areas</option>
                {areas.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 && !loading && (
        <p className="text-sm text-white/50">
          No goals yet. Write one on a board — what are you actually trying to achieve?
        </p>
      )}

      {rows.length > 0 && shown.length === 0 && (
        <p className="text-sm text-white/50">No goals match those filters.</p>
      )}

      {open.map((group) => (
        <StatusGroup key={group.status} group={group} people={data.people} nowIso={nowIso} />
      ))}

      {closed.length > 0 && (
        <div className="space-y-6 border-t border-white/10 pt-5">
          {closed.map((group) => (
            <StatusGroup
              key={group.status}
              group={group}
              people={data.people}
              nowIso={nowIso}
              dim
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'text-[var(--pyre-creme)]',
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className={cardClass}>
      <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</p>
      <p className={`mt-1 font-primary-semibold text-2xl ${tone}`}>{value}</p>
    </div>
  );
}

function StatusGroup({
  group,
  people,
  nowIso,
  dim = false,
}: {
  group: GoalStatusGroup;
  people: GoalsOverviewData['people'];
  nowIso: string;
  dim?: boolean;
}) {
  return (
    <section>
      <SectionTitle note={String(group.rows.length)}>
        {GOAL_STATUS_LABELS[group.status]}
      </SectionTitle>
      <ul className={`space-y-3 ${dim ? 'opacity-75' : ''}`}>
        {group.rows.map((row) => (
          <GoalRowCard key={row.goal.id} row={row} people={people} nowIso={nowIso} />
        ))}
      </ul>
    </section>
  );
}

function GoalRowCard({
  row,
  people,
  nowIso,
}: {
  row: GoalOverviewRow;
  people: GoalsOverviewData['people'];
  nowIso: string;
}) {
  const { goal, board, kpis, rollup } = row;
  const noun = board?.card_noun ?? 'task';

  const body = (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <h3 className="font-primary-semibold text-[var(--pyre-creme)]">{goal.title}</h3>
        <p className="mt-1 font-mono text-[11px] text-white/35">
          {board ? (
            <>
              {board.name}
              {board.archived && ' · archived'}
            </>
          ) : (
            'No board serves this goal yet'
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <GoalStatusBadge status={goal.status} />
          <PaceChip pace={rollup.pace} />
          {goal.owner_email && <QuietChip>{personName(goal.owner_email, people)}</QuietChip>}
          {goal.area && <QuietChip>{goal.area}</QuietChip>}
          {goal.target_date && (
            <QuietChip>
              {formatYmd(goal.target_date)}
              {!isClosedStatus(goal.status) && ` · ${formatDaysLeft(rollup.daysLeft)}`}
            </QuietChip>
          )}
        </div>
        {goal.status === 'completed' && (
          <p className="mt-2 text-xs text-white/50">
            Completed{goal.completed_by ? ` by ${personName(goal.completed_by, people)}` : ''}
            {goal.completed_at ? ` on ${formatYmd(goal.completed_at.slice(0, 10))}` : ''}.
            {goal.completion_note && (
              <span className="mt-1 block whitespace-pre-wrap text-white/40">
                {goal.completion_note}
              </span>
            )}
          </p>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <div>
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-white/35">
            {noun}s done
            {rollup.childCount > 0 && ` · with ${rollup.childCount} sub-goals`}
          </p>
          {rollup.tasks.total > 0 ? (
            <TaskBar progress={rollup.tasks} />
          ) : (
            <p className="font-mono text-xs text-white/30">No {noun}s filed yet</p>
          )}
        </div>
        <div>
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-white/35">
            KPIs{rollup.kpis.total > 0 && ` · ${rollup.kpis.met} of ${rollup.kpis.total} met`}
          </p>
          {kpis.length > 0 ? (
            <div className="space-y-2">
              {kpis.map((kpi) => (
                <KpiMeter key={kpi.id} kpi={kpi} nowIso={nowIso} compact />
              ))}
              {rollup.kpis.unmeasured > 0 && (
                <p className="font-mono text-[10px] text-white/30">
                  {rollup.kpis.unmeasured} never measured
                </p>
              )}
            </div>
          ) : (
            <p className="font-mono text-xs text-white/30">No KPIs yet</p>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <li className={`${cardClass} transition-colors ${board ? 'hover:border-white/25' : ''}`}>
      {board ? (
        <a href={`/admin/boards/${board.slug}`} className="block">
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}
