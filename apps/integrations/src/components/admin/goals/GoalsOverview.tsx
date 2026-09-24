// /admin/boards/all-goals: every goal on one page, where it stands, and the
// board that serves it. This is where a goal is managed whether or not a
// board serves it: a goal can be written here with no board at all, and
// clicking one opens it in place (GoalPanel) — edit, complete, delete, KPIs,
// its trail, and the board it is attached to. #goal-<id> opens one on load,
// which is where a link to a goal with no board lands.
//
// The strip at the top is the whole page in five numbers; below it the goals
// sit under their status — active, then planned, then the closed ones
// dimmed under a rule — and within a status the ones that need a look first
// (lib/goals/overview). Each row carries the same chips and meters the board and the
// index draw, so a goal reads the same here as everywhere else. Task
// progress and KPI progress stay side by side and never merge — the case
// worth catching is exactly the one where the work is done and the number
// is not.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BOARDS_HREF } from '@/lib/boards/types';
import type { GoalRow } from '@/lib/db';
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
  primaryButtonClass,
  QuietChip,
  SectionTitle,
  selectClass,
  send,
  TaskBar,
  toolbarButtonClass,
} from '../goalsUi';
import { readError } from '../incidentUi';
import { GoalForm } from './GoalForm';
import { GoalPanel } from './GoalPanel';

const GOAL_HASH = /^#goal-([0-9a-f-]{36})$/i;

/** The anchor a goal's row answers to, for links and the hash. */
function goalAnchorId(goalId: string): string {
  return `goal-${goalId}`;
}

export function GoalsOverview() {
  const [data, setData] = useState<GoalsOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState('all');
  const [area, setArea] = useState('all');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  /** A goal to bring into view once it has rendered open. */
  const scrollTo = useRef<string | null>(null);

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

  // #goal-<id> opens that goal — on arrival, and when a link on the page
  // changes the hash.
  useEffect(() => {
    const openFromHash = () => {
      const match = GOAL_HASH.exec(window.location.hash);
      if (!match) return;
      setOpenId(match[1]);
      scrollTo.current = match[1];
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: openId is the retry once the row renders open
  useEffect(() => {
    const id = scrollTo.current;
    if (!id || !data) return;
    const element = document.getElementById(goalAnchorId(id));
    if (!element) return;
    scrollTo.current = null;
    element.scrollIntoView({ block: 'start' });
  }, [data, openId]);

  const mutate = useCallback(
    async (run: () => Promise<unknown>) => {
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
    },
    [load]
  );

  const toggle = (goalId: string) => {
    const next = openId === goalId ? null : goalId;
    setOpenId(next);
    // Keep the hash in step so the open goal survives a reload and can be
    // copied as a link, without adding a history entry per click.
    const url = `${window.location.pathname}${window.location.search}${
      next ? `#${goalAnchorId(next)}` : ''
    }`;
    window.history.replaceState(null, '', url);
  };

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
  const rowProps = { data, nowIso, openId, busy, onToggle: toggle, mutate };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <a className={toolbarButtonClass} href={BOARDS_HREF}>
          ← All boards
        </a>
        {!creating && (
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy}
            onClick={() => setCreating(true)}
          >
            New goal
          </button>
        )}
      </div>
      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      {creating && (
        <GoalForm
          owners={data.owners}
          busy={busy}
          onCancel={() => setCreating(false)}
          onSave={async (values) => {
            const created: { id?: string } = {};
            await mutate(async () => {
              const { goal } = await send<{ goal: GoalRow }>('/api/admin/goals', 'POST', values);
              created.id = goal.id;
            });
            setCreating(false);
            // Open what was just written, since the next thing it needs is a
            // KPI or a board.
            if (created.id) {
              setOpenId(created.id);
              scrollTo.current = created.id;
              window.history.replaceState(null, '', `#${goalAnchorId(created.id)}`);
            }
          }}
        />
      )}

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
          No goals yet. What are you actually trying to achieve?
        </p>
      )}

      {rows.length > 0 && shown.length === 0 && (
        <p className="text-sm text-white/50">No goals match those filters.</p>
      )}

      {open.map((group) => (
        <StatusGroup key={group.status} group={group} {...rowProps} />
      ))}

      {closed.length > 0 && (
        <div className="space-y-6 border-t border-white/10 pt-5">
          {closed.map((group) => (
            <StatusGroup key={group.status} group={group} {...rowProps} dim />
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

interface RowProps {
  data: GoalsOverviewData;
  nowIso: string;
  openId: string | null;
  busy: boolean;
  onToggle: (goalId: string) => void;
  mutate: (run: () => Promise<unknown>) => Promise<void>;
}

function StatusGroup({
  group,
  dim = false,
  ...rowProps
}: RowProps & {
  group: GoalStatusGroup;
  dim?: boolean;
}) {
  return (
    <section>
      <SectionTitle note={String(group.rows.length)}>
        {GOAL_STATUS_LABELS[group.status]}
      </SectionTitle>
      <ul className="space-y-3">
        {group.rows.map((row) => (
          <GoalRowCard key={row.goal.id} row={row} dim={dim} {...rowProps} />
        ))}
      </ul>
    </section>
  );
}

function GoalRowCard({
  row,
  data,
  nowIso,
  openId,
  busy,
  onToggle,
  mutate,
  dim,
}: RowProps & { row: GoalOverviewRow; dim: boolean }) {
  const { goal, board, kpis, rollup } = row;
  const people = data.people;
  const noun = board?.card_noun ?? 'task';
  const open = openId === goal.id;

  return (
    <li
      id={goalAnchorId(goal.id)}
      className={`${cardClass} scroll-mt-4 transition-colors ${
        open ? 'border-white/25' : 'hover:border-white/25'
      } ${dim && !open ? 'opacity-75' : ''}`}
    >
      <button
        type="button"
        className="block w-full cursor-pointer text-left"
        aria-expanded={open}
        onClick={() => onToggle(goal.id)}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            <h3 className="break-words font-primary-semibold text-[var(--pyre-creme)]">
              {goal.title}
            </h3>
            <p className="mt-1 font-mono text-[11px] text-white/35">
              {board ? (
                <>
                  {board.name}
                  {board.archived && ' · archived'}
                </>
              ) : (
                'No board serves this goal'
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
            {/* Open, the KPIs are worked in the panel below instead. */}
            {!open && (
              <div>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-white/35">
                  KPIs
                  {rollup.kpis.total > 0 && ` · ${rollup.kpis.met} of ${rollup.kpis.total} met`}
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
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <GoalPanel row={row} data={data} nowIso={nowIso} busy={busy} mutate={mutate} />
        </div>
      )}
    </li>
  );
}
